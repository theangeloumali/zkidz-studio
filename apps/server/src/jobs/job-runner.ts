// Created by The Angelo Umali.
// Job skeleton (plan §8): one job at a time per lane, the row is the truth, and every transition is published as an event.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import { JOB_LANES, redactText, type Job } from "@zks/shared";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { JobRow } from "../dto.ts";
import type { EventBus } from "../events/event-bus.ts";
import type { Logger } from "../logging/logger.ts";
import { assertSameProjectDependencies, cancelBlockedDependents, hasDependenciesMet } from "./job-dependencies.ts";

interface JobProgress {
  readonly stage: string;
  readonly pct: number;
  readonly etaS?: number;
}
export type ReportProgress = (progress: JobProgress) => Promise<void>;
/** The signal aborts on cancel; a handler that then rejects leaves the job `interrupted`, so it can resume. */
export type JobHandler = (job: JobRow, reportProgress: ReportProgress, signal: AbortSignal) => Promise<void>;

export interface NewJob {
  readonly projectId: string;
  readonly kind: string;
  readonly videoId: string;
  readonly lane: JobLane;
  readonly params?: Record<string, unknown>;
  /** Ids of this project's jobs that must succeed first; they may run on other lanes. */
  readonly dependsOn?: readonly string[];
  readonly priority?: number;
}

export interface JobRunnerOptions {
  readonly database: StudioDatabase;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  /** Masked in stored job errors, which the UI and the agent read. */
  readonly studioHome?: string;
  readonly now?: () => number;
}

type JobLane = Job["lane"];

const PROGRESS_INTERVAL_MS = 1000;
const COMPLETE_PCT = 100;
const CANCELLED_BY_USER = "Cancelled by the user";

interface RunningJob {
  readonly projectId: string;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}
type FinishedStatus = "succeeded" | "failed" | "interrupted";

export class JobRunner {
  readonly #database: StudioDatabase;
  readonly #eventBus: EventBus;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #studioHome: string | undefined;
  readonly #handlers = new Map<string, JobHandler>();
  readonly #activeLanes = new Set<JobLane>();
  readonly #lanesToRecheck = new Set<JobLane>();
  readonly #drains = new Set<Promise<void>>();
  readonly #runningJobs = new Map<string, RunningJob>();

  constructor(options: JobRunnerOptions) {
    this.#database = options.database;
    this.#eventBus = options.eventBus;
    this.#logger = options.logger;
    this.#now = options.now ?? Date.now;
    this.#studioHome = options.studioHome;
  }

  registerHandler(kind: string, handler: JobHandler): void {
    this.#handlers.set(kind, handler);
  }

  /** Decorates a registered handler, e.g. with the spec snapshot, without touching the module that registered it. */
  wrapHandler(kind: string, wrap: (handler: JobHandler) => JobHandler): void {
    const handler = this.#handlers.get(kind);
    if (handler === undefined) throw new Error(`No handler for job kind "${kind}" to wrap`);
    this.#handlers.set(kind, wrap(handler));
  }

  async enqueue(newJob: NewJob): Promise<JobRow> {
    const dependsOn = [...(newJob.dependsOn ?? [])];
    await assertSameProjectDependencies(this.#database, newJob.projectId, dependsOn);
    const [job] = await this.#database
      .insert(jobs)
      .values({ ...newJob, params: newJob.params ?? {}, dependsOn })
      .returning();
    if (job === undefined) throw new Error("jobs insert returned no row");
    await this.#publishLifecycle("job.queued", job);
    if (dependsOn.length > 0) await this.#cancelBlockedDependents();
    this.#wakeLane(job.lane);
    return job;
  }

  /** A queued job is cancelled; a running one is aborted and left `interrupted`; a finished one is returned as is. */
  async cancel(jobId: string): Promise<JobRow> {
    const running = this.#runningJobs.get(jobId);
    if (running !== undefined) {
      running.controller.abort();
      await running.settled;
      return this.#readJob(jobId);
    }
    const [cancelled] = await this.#database
      .update(jobs)
      .set({ status: "cancelled", error: CANCELLED_BY_USER, finishedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
      .returning();
    if (cancelled === undefined) return this.#readJob(jobId);
    await this.#publishLifecycle("job.finished", cancelled);
    await this.#cancelBlockedDependents();
    return cancelled;
  }

  /** Requeues an interrupted job as its next attempt; its spec snapshot is kept, so it renders the same specs. */
  async resume(jobId: string): Promise<JobRow> {
    const [resumed] = await this.#database
      .update(jobs)
      .set({ status: "queued", attempt: sql`${jobs.attempt} + 1`, error: null, startedAt: null, finishedAt: null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "interrupted")))
      .returning();
    if (resumed === undefined) throw new Error(`Job ${jobId} cannot resume: only an interrupted job can`);
    await this.#publishLifecycle("job.queued", resumed);
    this.#wakeLane(resumed.lane);
    return resumed;
  }

  /** Resolves once every lane has run out of queued work. */
  async idle(): Promise<void> {
    while (this.#drains.size > 0) await Promise.allSettled([...this.#drains]);
  }

  /** Stop (plan §6.12): queued jobs go first, so a lane cannot start one while the running ones wind down to `interrupted`. */
  async cancelProject(projectId: string): Promise<void> {
    const cancelled = await this.#database
      .update(jobs)
      .set({ status: "cancelled", error: CANCELLED_BY_USER, finishedAt: new Date() })
      .where(and(eq(jobs.projectId, projectId), eq(jobs.status, "queued")))
      .returning();
    for (const job of cancelled) await this.#publishLifecycle("job.finished", job);
    await this.#cancelBlockedDependents();
    const running = [...this.#runningJobs.values()].filter((runningJob) => runningJob.projectId === projectId);
    for (const runningJob of running) runningJob.controller.abort();
    await Promise.all(running.map((runningJob) => runningJob.settled));
  }

  /** A row still `running` at startup belongs to a server that died; its process is gone. */
  async recoverInterrupted(): Promise<number> {
    const interrupted = await this.#database
      .update(jobs)
      .set({ status: "interrupted", finishedAt: new Date() })
      .where(eq(jobs.status, "running"))
      .returning({ id: jobs.id });
    return interrupted.length;
  }

  #wakeLane(lane: JobLane): void {
    if (this.#activeLanes.has(lane)) {
      this.#lanesToRecheck.add(lane);
      return;
    }
    this.#activeLanes.add(lane);
    const drain = this.#drainLane(lane).finally(() => this.#drains.delete(drain));
    this.#drains.add(drain);
  }

  async #drainLane(lane: JobLane): Promise<void> {
    try {
      for (;;) {
        this.#lanesToRecheck.delete(lane);
        const job = await this.#claimNext(lane);
        if (job !== undefined) await this.#run(job);
        else if (!this.#lanesToRecheck.has(lane)) return;
      }
    } catch (error) {
      this.#logger.error("job lane stopped", { lane, error });
    } finally {
      this.#activeLanes.delete(lane);
    }
  }

  async #claimNext(lane: JobLane): Promise<JobRow | undefined> {
    const [next] = await this.#database
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.lane, lane), eq(jobs.status, "queued"), hasDependenciesMet(this.#database)))
      .orderBy(desc(jobs.priority), asc(jobs.queuedAt))
      .limit(1);
    if (next === undefined) return undefined;
    const [claimed] = await this.#database
      .update(jobs)
      .set({ status: "running", startedAt: new Date() })
      .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")))
      .returning();
    return claimed;
  }

  async #run(job: JobRow): Promise<void> {
    const controller = new AbortController();
    const { promise: settled, resolve: markSettled } = Promise.withResolvers<void>();
    this.#runningJobs.set(job.id, { projectId: job.projectId, controller, settled });
    try {
      await this.#publishLifecycle("job.started", job);
      await this.#runHandler(job, controller.signal);
    } finally {
      this.#runningJobs.delete(job.id);
      markSettled();
    }
  }

  async #runHandler(job: JobRow, signal: AbortSignal): Promise<void> {
    try {
      const handler = this.#handlers.get(job.kind);
      if (handler === undefined) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(job, this.#createProgressReporter(job), signal);
      // A handler that ignores the abort and resolves still did not finish its work.
      if (signal.aborted) throw new Error(CANCELLED_BY_USER);
      await this.#finish(job, { status: "succeeded" });
    } catch (error) {
      if (signal.aborted) {
        await this.#finish(job, { status: "interrupted", error: CANCELLED_BY_USER });
        return;
      }
      const message = redactText(error instanceof Error ? error.message : String(error), { zksHome: this.#studioHome });
      this.#logger.error("job failed", { jobId: job.id, kind: job.kind, error: message });
      await this.#finish(job, { status: "failed", error: message });
    }
  }

  #createProgressReporter(job: JobRow): ReportProgress {
    let lastReportMs = Number.NEGATIVE_INFINITY;
    return async ({ stage, pct, etaS }) => {
      const nowMs = this.#now();
      if (pct < COMPLETE_PCT && nowMs - lastReportMs < PROGRESS_INTERVAL_MS) return;
      lastReportMs = nowMs;
      const roundedEtaS = etaS === undefined ? null : Math.round(etaS);
      await this.#database.update(jobs).set({ stage, pct, etaS: roundedEtaS }).where(eq(jobs.id, job.id));
      await this.#eventBus.publish({ type: "job.progress", projectId: job.projectId, jobId: job.id, stage, pct, ...(etaS === undefined ? {} : { etaS }) });
    };
  }

  async #finish(job: JobRow, outcome: { readonly status: FinishedStatus; readonly error?: string }): Promise<void> {
    const [finished] = await this.#database
      .update(jobs)
      .set({ status: outcome.status, error: outcome.error ?? null, finishedAt: new Date() })
      .where(eq(jobs.id, job.id))
      .returning();
    await this.#publishLifecycle("job.finished", finished ?? job);
    if (outcome.status === "failed") await this.#cancelBlockedDependents();
    // A dependent may wait on another lane, so every lane looks for newly runnable work.
    if (outcome.status === "succeeded") for (const lane of JOB_LANES) this.#wakeLane(lane);
  }

  async #cancelBlockedDependents(): Promise<void> {
    const cancelled = await cancelBlockedDependents(this.#database);
    for (const job of cancelled) await this.#publishLifecycle("job.finished", job);
  }

  async #readJob(jobId: string): Promise<JobRow> {
    const [row] = await this.#database.select().from(jobs).where(eq(jobs.id, jobId));
    if (row === undefined) throw new Error(`Job ${jobId} not found`);
    return row;
  }

  async #publishLifecycle(type: "job.queued" | "job.started" | "job.finished", job: JobRow): Promise<void> {
    await this.#eventBus.publish({ type, projectId: job.projectId, jobId: job.id, kind: job.kind, status: job.status });
  }
}
