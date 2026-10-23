// Created by The Angelo Umali.
// agent_sessions bookkeeping (plan §6.12): the resume key, the auth mode and the latest turn count and cost.
import type { SDKMessage, SDKResultMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import type { StudioDatabase } from "@zks/db";
import { agentSessions, projects } from "@zks/db/schema";
import type { AuthMode } from "@zks/shared";
import { and, eq, inArray } from "drizzle-orm";
import type { AgentCredential } from "../auth/connection-store.ts";

export type SessionStatus = (typeof agentSessions.$inferSelect)["status"];

/** The SDK path and mode T keep sessions in different config dirs, so each resumes only its own. */
export const SDK_AUTH_MODES = ["api_key", "cloud"] as const satisfies readonly AuthMode[];

/** The session the project's current row points at, so a restart picks up the same conversation. */
export async function findResumeSessionId(database: StudioDatabase, projectId: string, authModes: readonly AuthMode[]): Promise<string | undefined> {
  const [row] = await database
    .select({ sdkSessionId: agentSessions.sdkSessionId })
    .from(projects)
    .innerJoin(agentSessions, eq(projects.currentSessionId, agentSessions.id))
    .where(and(eq(projects.id, projectId), inArray(agentSessions.authMode, [...authModes])));
  return row?.sdkSessionId ?? undefined;
}

export interface CurrentSessionRecord {
  readonly projectId: string;
  readonly sdkSessionId: string;
  readonly model: string;
  readonly authMode: AuthMode;
}

/** Upserts the row and points the project at it; a resumed session keeps its id, so the same row comes back to life. */
export async function recordCurrentSession(database: StudioDatabase, record: CurrentSessionRecord): Promise<void> {
  const { projectId, sdkSessionId, model, authMode } = record;
  await database.transaction(async (transaction) => {
    const [row] = await transaction
      .insert(agentSessions)
      .values({ projectId, sdkSessionId, status: "active", model, authMode })
      .onConflictDoUpdate({ target: agentSessions.sdkSessionId, set: { status: "active", model, endedAt: null } })
      .returning({ id: agentSessions.id });
    await transaction.update(projects).set({ currentSessionId: row?.id, updatedAt: new Date() }).where(eq(projects.id, projectId));
  });
}

export interface SessionRecorderOptions {
  readonly database: StudioDatabase;
  readonly projectId: string;
  readonly credential: AgentCredential;
}

export class SessionRecorder {
  readonly #options: SessionRecorderOptions;
  #sdkSessionId: string | undefined;

  constructor(options: SessionRecorderOptions) {
    this.#options = options;
  }

  get sdkSessionId(): string | undefined {
    return this.#sdkSessionId;
  }

  async record(message: SDKMessage): Promise<void> {
    if (message.type === "system" && message.subtype === "init") await this.#recordStart(message);
    else if (message.type === "result") await this.#recordResult(message);
  }

  async markStatus(status: SessionStatus): Promise<void> {
    if (this.#sdkSessionId === undefined) return;
    const endedAt = status === "errored" || status === "closed" ? new Date() : null;
    await this.#options.database.update(agentSessions).set({ status, endedAt }).where(eq(agentSessions.sdkSessionId, this.#sdkSessionId));
  }

  async #recordStart(init: SDKSystemMessage): Promise<void> {
    this.#sdkSessionId = init.session_id;
    const { database, projectId, credential } = this.#options;
    const authMode = credential.kind === "apiKey" ? "api_key" : "cloud";
    await recordCurrentSession(database, { projectId, sdkSessionId: init.session_id, model: init.model, authMode });
  }

  async #recordResult(result: SDKResultMessage): Promise<void> {
    if (this.#sdkSessionId === undefined) return;
    await this.#options.database
      .update(agentSessions)
      .set({ status: "idle", numTurns: result.num_turns, totalCostUsd: String(result.total_cost_usd), usage: { ...result.usage } })
      .where(eq(agentSessions.sdkSessionId, this.#sdkSessionId));
  }
}
