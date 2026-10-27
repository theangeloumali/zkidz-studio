// Created by The Angelo Umali.
// delete_asset (plan §6.8): drops a media row the edit no longer needs; the approval card ran before this handler.
import { rm } from "node:fs/promises";
import { jobs, mediaAssets } from "@zks/db/schema";
import { CutSpecSchema, IngestResultSchema, InsertSpecSchema } from "@zks/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { ToolContext } from "../context.ts";
import { implementTool } from "../define-tool.ts";
import { IngestParamsSchema } from "../engine-jobs.ts";
import { readJobResult } from "../job-results.ts";
import { findProjectAsset, loadProject, projectRootOf, uploadedFilePath } from "../project-files.ts";
import { ToolError } from "../result.ts";
import { readCurrentSpec } from "../spec-store.ts";
import type { z } from "zod";

interface ProjectPlace {
  readonly videoId: string;
  readonly projectRoot: string;
}

const deleteAsset = implementTool("delete_asset", {
  description: "Delete a media asset the edit does not use. An uploaded file is removed; a file used in place stays where it is on disk.",
  handler: async (input, context) => {
    const project = await loadProject(context);
    const place = { videoId: project.videoId, projectRoot: projectRootOf(context, project) };
    const asset = await findProjectAsset(context, input.assetId);
    await assertNotInUse(context, place, asset.id);
    await context.db.delete(mediaAssets).where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.projectId, context.projectId)));
    const uploaded = uploadedFilePath(place.projectRoot, asset);
    if (uploaded !== undefined) await rm(uploaded, { force: true });
    return { output: { ok: true } };
  },
});

export const assetTools = [deleteAsset];

async function assertNotInUse(context: ToolContext, place: ProjectPlace, assetId: string): Promise<void> {
  const cuts = CutSpecSchema.safeParse(await readCurrentSpec(context, { videoId: place.videoId, kind: "cuts" }));
  const cutSourceId = cuts.success ? cuts.data.sourceAssetId : undefined;
  if (cutSourceId === assetId) throw new ToolError(`Asset ${assetId} is the source of the edit; point set_cuts at another source first`);
  const inserts = InsertSpecSchema.safeParse(await readCurrentSpec(context, { videoId: place.videoId, kind: "inserts" }));
  if (inserts.success && inserts.data.some((insert) => insert.srcAssetId === assetId)) {
    throw new ToolError(`Asset ${assetId} plays as an insert in the edit; remove that insert first`);
  }
  if (cutSourceId !== undefined && (await ingestInputsOf(context, place.projectRoot, cutSourceId)).has(assetId)) {
    throw new ToolError(`Asset ${assetId} is a clip the edit's source was built from`);
  }
  if ((await pendingIngestInputs(context)).has(assetId)) throw new ToolError(`Asset ${assetId} is being ingested; delete it once the ingest finishes`);
}

/** Every clip and insert an ingest still queued or running will read. */
async function pendingIngestInputs(context: ToolContext): Promise<Set<string>> {
  const pending = await context.db
    .select({ params: jobs.params })
    .from(jobs)
    .where(and(eq(jobs.projectId, context.projectId), eq(jobs.kind, "ingest"), inArray(jobs.status, ["queued", "running"])));
  return new Set(pending.flatMap((job) => inputsOf(IngestParamsSchema.safeParse(job.params).data)));
}

function inputsOf(params: z.infer<typeof IngestParamsSchema> | undefined): string[] {
  return params === undefined ? [] : [...params.clips.map((clip) => clip.assetId), ...(params.inserts ?? []).map((insert) => insert.srcAssetId)];
}

/** The clips and inserts the ingest that produced `sourceAssetId` joined; empty when the source is a plain upload. */
async function ingestInputsOf(context: ToolContext, projectRoot: string, sourceAssetId: string): Promise<Set<string>> {
  const ingestJobs = await context.db
    .select({ id: jobs.id, params: jobs.params })
    .from(jobs)
    .where(and(eq(jobs.projectId, context.projectId), eq(jobs.kind, "ingest"), eq(jobs.status, "succeeded")))
    .orderBy(desc(jobs.queuedAt));
  for (const ingestJob of ingestJobs) {
    const result = IngestResultSchema.safeParse(await readJobResult(projectRoot, ingestJob.id));
    const params = IngestParamsSchema.safeParse(ingestJob.params);
    if (!result.success || result.data.sourceAssetId !== sourceAssetId || !params.success) continue;
    return new Set(inputsOf(params.data));
  }
  return new Set();
}
