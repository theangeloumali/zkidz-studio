// Created by The Angelo Umali.
// Job skeleton (plan §8): one job at a time per lane, the row is the truth, and every transition is published as an event.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import type { Job } from "@zks/shared";
import { and, asc, desc, eq } from "drizzle-orm";
import type { JobRow } from "../dto.ts";
import type { EventBus } from "../events/event-bus.ts";
import type { Logger } from "../logging/logger.ts";
import { redactSecrets } from "../logging/redact.ts";

export interface JobProgress {
  readonly stage: string;
  readonly pct: number;
  readonly etaS?: number;
}
export type ReportProgress = (progress: JobProgress) => Promise<void>;
export type JobHandler = (job: JobRow, reportProgress: ReportProgress) => Promise<void>;

export interface NewJob {
  readonly projectId: string;
  readonly kind: string;
  readonly videoId: string;
  readonly lane: JobLane;
  readonly params?: Record<string, unknown>;
}

export interface JobRunnerOptions {
  readonly database: StudioDatabase;
  readonly eventBus: EventBus;
  readonly logger: Logger;
  readonly now?: () => number;
}

type JobLane = Job["lane"];

const PROGRESS_INTERVAL_MS = 1000;
const COMPLETE_PCT = 100;

export class JobRunner {
  readonly #database: StudioDatabase;
  readonly #eventBus: EventBus;
  readonly #logger: Logger;
  readonly #now: () => number;
  readonly #handlers = new Map<string, JobHandler>();
  readonly #activeLanes = new Set<JobLane>();
  readonly #lanesToRecheck = new Set<JobLane>();
  readonly #drains = new Set<Promise<void>>();

  constructor(options: JobRunnerOptions) {
    this.#database = options.database;
    this.#eventBus = options.eventBus;
    this.#logger = options.logger;
    this.#now = options.now ?? Date.now;
  }

  registerHandler(kind: string, handler: JobHandler): void {
    this.#handlers.set(kind, handler);
  }

  async enqueue(newJob: NewJob): Promise<JobRow> {
    const [job] = await this.#database
      .insert(jobs)
      .values({ ...newJob, params: newJob.params ?? {} })
      .returning();
    if (job === undefined) throw new Error("jobs insert returned no row");
    await this.#publishLifecycle("job.queued", job);
    this.#wakeLane(job.lane);
    return job;
  }

  /** Resolves once every lane has run out of queued work. */
  async idle(): Promise<void> {
    while (this.#drains.size > 0) await Promise.allSettled([...this.#drains]);
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
      .where(and(eq(jobs.lane, lane), eq(jobs.status, "queued")))
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
    await this.#publishLifecycle("job.started", job);
    try {
      const handler = this.#handlers.get(job.kind);
      if (handler === undefined) throw new Error(`No handler for job kind "${job.kind}"`);
      await handler(job, this.#createProgressReporter(job));
      await this.#finish(job, { status: "succeeded" });
    } catch (error) {
      const message = redactSecrets(error instanceof Error ? error.message : String(error));
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

  async #finish(job: JobRow, outcome: { readonly status: "succeeded" | "failed"; readonly error?: string }): Promise<void> {
    const [finished] = await this.#database
      .update(jobs)
      .set({ status: outcome.status, error: outcome.error ?? null, finishedAt: new Date() })
      .where(eq(jobs.id, job.id))
      .returning();
    await this.#publishLifecycle("job.finished", finished ?? job);
  }

  async #publishLifecycle(type: "job.queued" | "job.started" | "job.finished", job: JobRow): Promise<void> {
    await this.#eventBus.publish({ type, projectId: job.projectId, jobId: job.id, kind: job.kind, status: job.status });
  }
}
