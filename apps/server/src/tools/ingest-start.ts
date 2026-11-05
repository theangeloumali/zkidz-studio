// Created by The Angelo Umali.
// The one way ingest and transcribe jobs start, for the agent's tools and for the upload that begins them on its own.
import type { StudioDatabase } from "@zks/db";
import { jobs, projects } from "@zks/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { z } from "zod";
import { projectDir } from "../config.ts";
import type { JobRunner } from "../jobs/job-runner.ts";
import { readProjectTemplate } from "../onboarding/project-template.ts";
import { ingestModeFor, IngestParamsSchema, TranscribeParamsSchema } from "./engine-jobs.ts";
import { readJobResult } from "./job-results.ts";

type IngestInput = Pick<z.infer<typeof IngestParamsSchema>, "clips" | "inserts">;

export interface IngestStartDeps {
  readonly db: StudioDatabase;
  readonly jobs: Pick<JobRunner, "enqueue" | "cancel">;
  readonly studioHome: string;
}

const OPEN_OR_DONE = ["queued", "running", "succeeded"] as const;
// Plan §7.4: the pinned whisper-cli is a CPU build, and on CPU the quantised turbo is the model; base mishears Taglish.
export const TRANSCRIBE_DEFAULTS = { language: "auto", model: "turbo" } as const;

type TranscribeParams = z.infer<typeof TranscribeParamsSchema>;

/**
 * Starts an ingest of `input`, or returns the job that already covers it: a running one to follow, or the
 * latest succeeded one. Every other open ingest is stopped, since every ingest writes the same source.
 */
export async function startIngest(deps: IngestStartDeps, target: { projectId: string; videoId: string; input: IngestInput }): Promise<{ jobId: string }> {
  const template = await readProjectTemplate(deps.db, target.projectId);
  const wanted = comparable({ ...target.input, mode: ingestModeFor(target.input, template?.ingestMode) });
  const ingests = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, target.projectId), eq(jobs.kind, "ingest"), inArray(jobs.status, OPEN_OR_DONE)))
    .orderBy(desc(jobs.queuedAt));
  const open = ingests.filter((job) => job.status !== "succeeded");
  const latestSucceeded = ingests.find((job) => job.status === "succeeded");
  const candidate = [...open, ...(latestSucceeded === undefined ? [] : [latestSucceeded])].find((job) => comparable(job.params) === wanted);
  const reusable =
    candidate !== undefined && (candidate.status !== "succeeded" || (await producedResult(deps, candidate.id, target.projectId))) ? candidate : undefined;
  // Any other open ingest would write over the source this call settles on, the reused one included.
  for (const job of open) if (job.id !== reusable?.id) await deps.jobs.cancel(job.id);
  if (reusable !== undefined) return { jobId: reusable.id };

  const params = { ...target.input, mode: ingestModeFor(target.input, template?.ingestMode) };
  const started = await deps.jobs.enqueue({ projectId: target.projectId, kind: "ingest", videoId: target.videoId, lane: "gpu", params });
  return { jobId: started.id };
}

/**
 * Starts a transcription, or returns the one that covers it: the same request queued since the latest ingest, open or
 * the latest succeeded. Every other open transcription is stopped, since they all write the same transcript.
 */
export async function startTranscribe(
  deps: IngestStartDeps,
  target: { projectId: string; videoId: string; params: TranscribeParams },
): Promise<{ jobId: string }> {
  const [latestIngest] = await deps.db
    .select({ queuedAt: jobs.queuedAt })
    .from(jobs)
    .where(and(eq(jobs.projectId, target.projectId), eq(jobs.kind, "ingest"), ne(jobs.status, "cancelled")))
    .orderBy(desc(jobs.queuedAt))
    .limit(1);
  const transcriptions = await deps.db
    .select()
    .from(jobs)
    .where(and(eq(jobs.projectId, target.projectId), eq(jobs.kind, "transcribe"), inArray(jobs.status, OPEN_OR_DONE)))
    .orderBy(desc(jobs.queuedAt));
  const open = transcriptions.filter((job) => job.status !== "succeeded");
  const latestSucceeded = transcriptions.find((job) => job.status === "succeeded");
  const wanted = JSON.stringify(TranscribeParamsSchema.parse(target.params));
  // One queued before the latest ingest heard the audio that ingest replaces.
  const candidate = [...open, ...(latestSucceeded === undefined ? [] : [latestSucceeded])].find(
    (job) => (latestIngest === undefined || job.queuedAt >= latestIngest.queuedAt) && comparableTranscribe(job.params) === wanted,
  );
  const reusable =
    candidate !== undefined && (candidate.status !== "succeeded" || (await producedResult(deps, candidate.id, target.projectId))) ? candidate : undefined;
  for (const job of open) if (job.id !== reusable?.id) await deps.jobs.cancel(job.id);
  if (reusable !== undefined) return { jobId: reusable.id };

  const started = await deps.jobs.enqueue({ projectId: target.projectId, kind: "transcribe", videoId: target.videoId, lane: "whisper", params: target.params });
  return { jobId: started.id };
}

/** Ids of the open ingest jobs of a project. */
export async function openIngestJobIds(db: StudioDatabase, projectId: string): Promise<string[]> {
  const open = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "ingest"), inArray(jobs.status, ["queued", "running"])));
  return open.map((job) => job.id);
}

/** A succeeded job whose result file is gone, or whose project is, left nothing to reuse. */
async function producedResult(deps: IngestStartDeps, jobId: string, projectId: string): Promise<boolean> {
  const [project] = await deps.db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId));
  if (project === undefined) return false;
  return (await readJobResult(projectDir(deps.studioHome, project.slug), jobId)) !== undefined;
}

/** Parsed first, so key order and absent options cannot make two equal requests differ. */
function comparable(params: unknown): string {
  const parsed = IngestParamsSchema.safeParse(params);
  return parsed.success ? JSON.stringify({ clips: parsed.data.clips, inserts: parsed.data.inserts, mode: parsed.data.mode }) : "";
}

function comparableTranscribe(params: unknown): string {
  const parsed = TranscribeParamsSchema.safeParse(params);
  return parsed.success ? JSON.stringify(parsed.data) : "";
}
