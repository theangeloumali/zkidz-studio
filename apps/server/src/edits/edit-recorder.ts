// Created by The Angelo Umali.
// Turns the event stream into edit rows: open on the first agent activity, close on a delivered export (plan 2026-10-29, slice E).
import type { StudioDatabase } from "@zks/db";
import { agentSessions, edits, projects } from "@zks/db/schema";
import { AgentKindSchema, UsageSourceSchema, type AgentKind, type StudioEvent, type UsageSource } from "@zks/shared";
import { eq } from "drizzle-orm";
import type { EventBus } from "../events/event-bus.ts";
import { EXPORT_JOB_KIND } from "../jobs/deliverables.ts";
import type { Logger } from "../logging/logger.ts";
import { readEditFacts } from "./edit-facts.ts";
import { listOpenEdits, numberOrNull, type EditRow } from "./edit-store.ts";
import { UsageLedger, type UsageReading } from "./usage-ledger.ts";

const DEFAULT_PERSIST_INTERVAL_MS = 2000;

export interface EditRecorderDeps {
  readonly database: StudioDatabase;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly persistIntervalMs?: number;
}

interface OpenEdit {
  readonly id: string;
  readonly videoId: string;
  readonly startedAt: Date;
  agentKind: AgentKind;
  turns: number;
  answers: Record<string, string>;
}

interface ProjectState {
  readonly ledger: UsageLedger;
  currentSessionId: string | undefined;
  openEdit: OpenEdit | undefined;
  /** Set when an export closes an edit, so that turn's tail does not open the next one. */
  isClosedMidTurn: boolean;
}

export class EditRecorder {
  readonly #database: StudioDatabase;
  readonly #eventBus: EventBus;
  readonly #logger: Logger;
  readonly #persistIntervalMs: number;
  readonly #projects = new Map<string, ProjectState>();
  readonly #dirtyProjectIds = new Set<string>();
  #queue: Promise<void> = Promise.resolve();
  #persistTimer: NodeJS.Timeout | undefined;
  #unsubscribe: (() => void) | undefined;

  constructor(deps: EditRecorderDeps) {
    this.#database = deps.database;
    this.#eventBus = deps.eventBus;
    this.#logger = deps.logger;
    this.#persistIntervalMs = deps.persistIntervalMs ?? DEFAULT_PERSIST_INTERVAL_MS;
  }

  /** Recovery is queued first, so events that arrive meanwhile wait for it. */
  start(): Promise<void> {
    const recovered = this.#enqueue(() => this.#recoverOpenEdits());
    this.#unsubscribe = this.#eventBus.subscribeAll((event) => void this.#enqueue(() => this.#handle(event)));
    return recovered;
  }

  stop(): void {
    this.#unsubscribe?.();
    clearTimeout(this.#persistTimer);
  }

  /** Resolves once every event delivered so far has been handled. */
  idle(): Promise<void> {
    return this.#queue;
  }

  flush(): Promise<void> {
    return this.#enqueue(() => this.#persistDirty());
  }

  /** The answers to an open edit's question cards; written at once since they are the user's words. */
  recordAnswers(projectId: string, answers: Readonly<Record<string, string>>): Promise<void> {
    return this.#enqueue(async () => {
      const openEdit = this.#projects.get(projectId)?.openEdit;
      if (openEdit === undefined) return;
      openEdit.answers = { ...openEdit.answers, ...answers };
      await this.#updateEdit(projectId, { facts: { cutReasons: [], answers: openEdit.answers } });
    });
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    this.#queue = this.#queue.then(task).catch((error: unknown) => this.#logger.error("edit recorder failed", { error }));
    return this.#queue;
  }

  async #handle(event: StudioEvent): Promise<void> {
    const state = this.#stateOf(event.projectId);
    switch (event.type) {
      case "session.started":
        state.currentSessionId = event.sessionId;
        state.isClosedMidTurn = false;
        return this.#seedResumedSpend(state, event.sessionId);
      case "prompt.submitted":
        state.isClosedMidTurn = false;
        return this.#countTurn(event.projectId, state);
      case "tool.called":
        return state.isClosedMidTurn ? undefined : this.#ensureOpen(event.projectId, state);
      case "turn.completed":
        return this.#completeTurn(event.projectId, state, event.costUsd);
      case "usage.reported":
        return this.#observe(event.projectId, state, event);
      case "job.finished":
        return event.kind === EXPORT_JOB_KIND && event.status === "succeeded" ? this.#deliver(event.projectId, state, event.jobId) : undefined;
      default:
        return undefined;
    }
  }

  #stateOf(projectId: string): ProjectState {
    const existing = this.#projects.get(projectId);
    if (existing !== undefined) return existing;
    const created: ProjectState = { ledger: new UsageLedger(), currentSessionId: undefined, openEdit: undefined, isClosedMidTurn: false };
    this.#projects.set(projectId, created);
    return created;
  }

  /** A resumed SDK session reports its lifetime cost, so the part spent before this edit becomes its baseline. */
  async #seedResumedSpend(state: ProjectState, sessionId: string): Promise<void> {
    if (state.ledger.hasReading(sessionId, "sdk")) return;
    const [session] = await this.#database
      .select({ totalCostUsd: agentSessions.totalCostUsd })
      .from(agentSessions)
      .where(eq(agentSessions.sdkSessionId, sessionId));
    const priorCostUsd = numberOrNull(session?.totalCostUsd ?? null);
    if (priorCostUsd !== null) state.ledger.seed(sessionId, "sdk", { costUsd: priorCostUsd });
  }

  async #countTurn(projectId: string, state: ProjectState): Promise<void> {
    if (state.openEdit === undefined) return this.#ensureOpen(projectId, state, 1);
    state.openEdit.turns += 1;
    this.#markDirty(projectId);
  }

  /** ASSUMPTION: no surface publishes both prompt.submitted and turn.completed for one turn, so each counts one. */
  async #completeTurn(projectId: string, state: ProjectState, costUsd: number | undefined): Promise<void> {
    if (state.isClosedMidTurn) state.isClosedMidTurn = false;
    else await this.#countTurn(projectId, state);
    if (costUsd !== undefined && state.currentSessionId !== undefined) state.ledger.observe(state.currentSessionId, "sdk", { costUsd });
  }

  #observe(projectId: string, state: ProjectState, report: { readonly sessionId: string; readonly source: UsageSource } & UsageReading): void {
    state.ledger.observe(report.sessionId, report.source, report);
    if (state.openEdit === undefined) return;
    const reportingAgent = AgentKindSchema.safeParse(report.source);
    if (reportingAgent.success) state.openEdit.agentKind = reportingAgent.data;
    this.#markDirty(projectId);
  }

  async #ensureOpen(projectId: string, state: ProjectState, turns = 0): Promise<void> {
    if (state.openEdit !== undefined) return;
    const [project] = await this.#database.select({ videoId: projects.videoId }).from(projects).where(eq(projects.id, projectId));
    if (project === undefined) return;
    const [row] = await this.#database.insert(edits).values({ projectId, videoId: project.videoId, agentKind: "claude", turns }).returning();
    if (row === undefined) throw new Error("edits insert returned no row");
    // ASSUMPTION: an open edit marks the project "editing"; the export moves it to "delivered".
    await this.#database.update(projects).set({ status: "editing" }).where(eq(projects.id, projectId));
    state.openEdit = { id: row.id, videoId: row.videoId, startedAt: row.startedAt, agentKind: "claude", turns, answers: {} };
    state.ledger.openEdit();
  }

  async #deliver(projectId: string, state: ProjectState, exportJobId: string): Promise<void> {
    await this.#database.update(projects).set({ status: "delivered" }).where(eq(projects.id, projectId));
    const openEdit = state.openEdit;
    if (openEdit === undefined) return;
    const finishedAt = new Date();
    const totals = state.ledger.totals();
    const facts = await readEditFacts(this.#database, { projectId, videoId: openEdit.videoId, answers: openEdit.answers });
    await this.#updateEdit(projectId, { ...this.#runningValues(state, openEdit), status: "closed", finishedAt, exportJobId, facts });
    state.openEdit = undefined;
    state.ledger.closeEdit();
    state.isClosedMidTurn = true;
    this.#dirtyProjectIds.delete(projectId);
    const figures = Object.fromEntries(Object.entries(totals).filter((entry): entry is [string, number] => entry[1] !== null));
    await this.#eventBus.publish({
      type: "edit.closed",
      projectId,
      editId: openEdit.id,
      ...figures,
      durationMs: finishedAt.getTime() - openEdit.startedAt.getTime(),
    });
  }

  #markDirty(projectId: string): void {
    this.#dirtyProjectIds.add(projectId);
    if (this.#persistTimer !== undefined) return;
    this.#persistTimer = setTimeout(() => {
      this.#persistTimer = undefined;
      void this.flush();
    }, this.#persistIntervalMs);
    this.#persistTimer.unref();
  }

  async #persistDirty(): Promise<void> {
    const projectIds = [...this.#dirtyProjectIds];
    this.#dirtyProjectIds.clear();
    for (const projectId of projectIds) {
      const state = this.#projects.get(projectId);
      if (state?.openEdit !== undefined) await this.#updateEdit(projectId, this.#runningValues(state, state.openEdit));
    }
  }

  #runningValues(state: ProjectState, openEdit: OpenEdit) {
    const totals = state.ledger.totals();
    return {
      agentKind: openEdit.agentKind,
      turns: openEdit.turns,
      costUsd: totals.costUsd === null ? null : totals.costUsd.toFixed(6),
      costSource: state.ledger.costSource,
      inputTokens: totals.inputTokens,
      outputTokens: totals.outputTokens,
      cacheTokens: totals.cacheTokens,
    };
  }

  /** A deleted project took its edit with it (cascade), so the recorder forgets the edit too. */
  async #updateEdit(projectId: string, values: Partial<typeof edits.$inferInsert>): Promise<void> {
    const state = this.#projects.get(projectId);
    const editId = state?.openEdit?.id;
    if (state === undefined || editId === undefined) return;
    const [updated] = await this.#database.update(edits).set(values).where(eq(edits.id, editId)).returning({ id: edits.id });
    if (updated === undefined) {
      state.openEdit = undefined;
      state.ledger.closeEdit();
    }
  }

  async #recoverOpenEdits(): Promise<void> {
    for (const row of await listOpenEdits(this.#database)) {
      const state = this.#stateOf(row.projectId);
      if (state.openEdit === undefined) this.#recover(state, row);
    }
  }

  #recover(state: ProjectState, row: EditRow): void {
    const agentKind = AgentKindSchema.safeParse(row.agentKind);
    const costSource = UsageSourceSchema.safeParse(row.costSource);
    state.openEdit = {
      id: row.id,
      videoId: row.videoId,
      startedAt: row.startedAt,
      agentKind: agentKind.success ? agentKind.data : "claude",
      turns: row.turns,
      answers: row.facts?.answers ?? {},
    };
    state.ledger.recoverEdit({
      carried: { costUsd: numberOrNull(row.costUsd), inputTokens: row.inputTokens, outputTokens: row.outputTokens, cacheTokens: row.cacheTokens },
      costSource: costSource.success ? costSource.data : null,
    });
  }
}
