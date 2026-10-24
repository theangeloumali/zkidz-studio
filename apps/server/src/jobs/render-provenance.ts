// Created by The Angelo Umali.
// What a finished render_master recorded about its master: the source and spec snapshot QC and export must match.
import type { StudioDatabase } from "@zks/db";
import { jobs } from "@zks/db/schema";
import { MasterRenderResultSchema } from "@zks/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { readJobResult } from "../tools/job-results.ts";

type MasterRender = z.infer<typeof MasterRenderResultSchema>;

const IN_FLIGHT_STATUSES = ["queued", "running"] as const;
const RenderedPathSchema = z.object({ path: z.string() });

interface VideoOfProject {
  readonly projectId: string;
  /** The base video id: a Reels render runs under its full edit's job. */
  readonly videoId: string;
}

/** A render landing mid-step would replace the master QC or export is about to judge. */
export async function assertNoRenderInFlight(database: StudioDatabase, video: VideoOfProject, nextStep: string): Promise<void> {
  const [render] = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.projectId, video.projectId), eq(jobs.kind, "render_master"), eq(jobs.videoId, video.videoId), inArray(jobs.status, [...IN_FLIGHT_STATUSES])),
    )
    .limit(1);
  if (render !== undefined) throw new Error(`${video.videoId} is still rendering; ${nextStep} once render_master finishes`);
}

/** The newest finished render that wrote this master; undefined when none did, or it predates recorded provenance. */
export async function findRenderOf(
  database: StudioDatabase,
  projectRoot: string,
  video: VideoOfProject,
  masterRelPath: string,
): Promise<MasterRender | undefined> {
  const renders = await database
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.projectId, video.projectId), eq(jobs.kind, "render_master"), eq(jobs.videoId, video.videoId), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.finishedAt));
  for (const render of renders) {
    const result: unknown = await readJobResult(projectRoot, render.id);
    if (RenderedPathSchema.safeParse(result).data?.path !== masterRelPath) continue;
    const parsed = MasterRenderResultSchema.safeParse(result);
    return parsed.success ? parsed.data : undefined;
  }
  return undefined;
}
