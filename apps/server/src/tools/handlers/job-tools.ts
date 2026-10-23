// Created by The Angelo Umali.
// Long work goes through the Phase 1 job runner: ingest and transcribe answer with a jobId, job_* follow it (plan §6.8).
import { jobs } from "@zks/db/schema";
import type { JobStatus } from "@zks/shared";
import { and, eq } from "drizzle-orm";
import type { JobRow } from "../../dto.ts";
import type { ToolContext } from "../context.ts";
import { implementTool } from "../define-tool.ts";
import { readJobResult } from "../job-results.ts";
import { findProjectAsset, loadProject, projectRootOf } from "../project-files.ts";
import { ToolError } from "../result.ts";

const DEFAULT_LANGUAGE = "auto";
const DEFAULT_WHISPER_MODEL = "base";
const MS_PER_S = 1000;
const OPEN_STATUSES: ReadonlySet<JobStatus> = new Set(["queued", "running"]);

const ingest = implementTool("ingest", {
  description:
    "Join the given clips (by assetId, optional zoom) into the edit's source, with optional screen-recording inserts. Returns a jobId; follow it with job_wait.",
  handler: async (input, context) => {
    const assetIds = [...input.clips.map((clip) => clip.assetId), ...(input.inserts ?? []).map((insert) => insert.srcAssetId)];
    await Promise.all(assetIds.map((assetId) => findProjectAsset(context, assetId)));
    const project = await loadProject(context);
    const job = await context.jobs.enqueue({ projectId: context.projectId, kind: "ingest", videoId: project.videoId, lane: "gpu", params: { ...input } });
    return { output: { jobId: job.id } };
  },
});

const transcribe = implementTool("transcribe", {
  description: "Transcribe the edit's source with whisper.cpp. Returns a jobId; follow it with job_wait, then read_transcript.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const params = { language: input.language ?? DEFAULT_LANGUAGE, model: input.model ?? DEFAULT_WHISPER_MODEL };
    const job = await context.jobs.enqueue({ projectId: context.projectId, kind: "transcribe", videoId: project.videoId, lane: "whisper", params });
    return { output: { jobId: job.id } };
  },
});

const jobStatus = implementTool("job_status", {
  description: "A job's status, stage, percent and, once it succeeded, its result.",
  handler: async (input, context) => ({ output: await jobSnapshot(context, input.jobId) }),
});

const jobWait = implementTool("job_wait", {
  description: "Wait up to timeoutS (max 120) for a job to finish, then return its status like job_status. Call again if it is still running.",
  handler: async (input, context, signal) => {
    const job = await findProjectJob(context, input.jobId);
    if (OPEN_STATUSES.has(job.status)) await waitForJobToClose(context, { jobId: input.jobId, timeoutMs: input.timeoutS * MS_PER_S }, signal);
    return { output: await jobSnapshot(context, input.jobId) };
  },
});

const jobCancel = implementTool("job_cancel", {
  description: "Cancel a job that has not started yet.",
  handler: async (input, context) => {
    const [cancelled] = await context.db
      .update(jobs)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(and(eq(jobs.id, input.jobId), eq(jobs.projectId, context.projectId), eq(jobs.status, "queued")))
      .returning();
    if (cancelled === undefined) {
      const job = await findProjectJob(context, input.jobId);
      // The Phase 1 runner has no way to stop a handler mid-run.
      throw new ToolError(job.status === "running" ? "A running job cannot be cancelled" : `The job is already ${job.status}`);
    }
    await context.events.publish({ type: "job.finished", projectId: context.projectId, jobId: cancelled.id, kind: cancelled.kind, status: cancelled.status });
    return { output: { ok: true } };
  },
});

async function findProjectJob(context: ToolContext, jobId: string): Promise<JobRow> {
  const [job] = await context.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.projectId, context.projectId)));
  if (job === undefined) throw new ToolError(`There is no job ${jobId} in this project`);
  return job;
}

async function jobSnapshot(context: ToolContext, jobId: string) {
  const job = await findProjectJob(context, jobId);
  const result = job.status === "succeeded" ? await readJobResult(projectRootOf(context, await loadProject(context)), jobId) : undefined;
  return {
    jobId: job.id,
    status: job.status,
    ...(job.stage === null ? {} : { stage: job.stage }),
    ...(job.pct === null ? {} : { pct: job.pct }),
    ...(job.etaS === null ? {} : { etaS: job.etaS }),
    logTail: job.error === null ? [] : [job.error],
    ...(result === undefined ? {} : { result }),
  };
}

// Subscribes before re-reading the row, so a job that finishes in between is not missed.
async function waitForJobToClose(context: ToolContext, wait: { jobId: string; timeoutMs: number }, signal?: AbortSignal): Promise<void> {
  let unsubscribe: () => void = () => undefined;
  let timer: NodeJS.Timeout | undefined;
  const closed = new Promise<void>((resolve) => {
    unsubscribe = context.events.subscribe([context.projectId], (event) => {
      if (event.type === "job.finished" && event.jobId === wait.jobId) resolve();
    });
    timer = setTimeout(resolve, wait.timeoutMs);
    signal?.addEventListener("abort", () => resolve(), { once: true });
  });
  try {
    const job = await findProjectJob(context, wait.jobId);
    if (OPEN_STATUSES.has(job.status)) await closed;
  } finally {
    unsubscribe();
    clearTimeout(timer);
  }
}

export const jobTools = [ingest, transcribe, jobStatus, jobWait, jobCancel];
