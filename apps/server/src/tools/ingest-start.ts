// Created by The Angelo Umali.
// The one way an ingest job starts, for the agent's tool and for the upload that begins one on its own.
import type { StudioDatabase } from "@zks/db";
import { jobs, projects } from "@zks/db/schema";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { z } from "zod";
import { projectDir } from "../config.ts";
import type { JobRunner } from "../jobs/job-runner.ts";
import { readProjectTemplate } from "../onboarding/project-template.ts";
import { ingestModeFor, IngestParamsSchema } from "./engine-jobs.ts";
import { readJobResult } from "./job-results.ts";

export type IngestInput = Pick<z.infer<typeof IngestParamsSchema>, "clips" | "inserts">;

export interface IngestStartDeps {
  readonly db: StudioDatabase;
  readonly jobs: Pick<JobRunner, "enqueue" | "cancel">;
  readonly studioHome: string;
}

const OPEN_OR_DONE = ["queued", "running", "succeeded"] as const;

/**
 * Starts an ingest of `input`, or returns the job that already covers it: a running one to follow, or the
 * latest succeeded one. An open ingest of anything else is stopped, since every ingest writes the same source.
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
  const reusable = [...open, ...(latestSucceeded === undefined ? [] : [latestSucceeded])].find((job) => comparable(job.params) === wanted);
  if (reusable !== undefined && (reusable.status !== "succeeded" || (await producedSource(deps, reusable.id, target.projectId)))) return { jobId: reusable.id };

  for (const job of open) await deps.jobs.cancel(job.id);
  const params = { ...target.input, mode: ingestModeFor(target.input, template?.ingestMode) };
  const started = await deps.jobs.enqueue({ projectId: target.projectId, kind: "ingest", videoId: target.videoId, lane: "gpu", params });
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

/** A succeeded job whose result file is gone, or whose project is, did not leave a source to reuse. */
async function producedSource(deps: IngestStartDeps, jobId: string, projectId: string): Promise<boolean> {
  const [project] = await deps.db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, projectId));
  if (project === undefined) return false;
  return (await readJobResult(projectDir(deps.studioHome, project.slug), jobId)) !== undefined;
}

/** Parsed first, so key order and absent options cannot make two equal requests differ. */
function comparable(params: unknown): string {
  const parsed = IngestParamsSchema.safeParse(params);
  return parsed.success ? JSON.stringify({ clips: parsed.data.clips, inserts: parsed.data.inserts, mode: parsed.data.mode }) : "";
}
