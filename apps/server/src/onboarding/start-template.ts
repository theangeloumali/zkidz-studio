// Created by The Angelo Umali.
// Starting an edit from a Home template: the ingest tool runs with the clips the template's mode expects.
import { mediaAssets } from "@zks/db/schema";
import type { HomeTemplate, InsertSpec, StartTemplateRequest } from "@zks/shared";
import { and, eq, inArray } from "drizzle-orm";
import { HttpError } from "../http/http-error.ts";
import type { ToolContext } from "../tools/context.ts";
import { STUDIO_TOOLS_BY_NAME } from "../tools/catalog.ts";
import { writeProjectTemplate } from "./project-template.ts";

const badRequest = (message: string) => new HttpError(400, message);

function checkFootageFits(template: HomeTemplate, request: StartTemplateRequest): void {
  const hasInsert = request.insertAssetId !== undefined;
  if (template.ingestMode === "single" && (request.clipAssetIds.length !== 1 || hasInsert)) throw badRequest(`${template.name} takes one clip`);
  if (template.ingestMode === "join" && hasInsert) throw badRequest(`${template.name} takes clips only`);
  if (template.ingestMode === "showcase" && (request.clipAssetIds.length !== 1 || !hasInsert)) {
    throw badRequest(`${template.name} takes one camera clip and one screen recording`);
  }
}

/** The screen recording plays from the start, for as long as both files last; the agent refines it with sync_inserts. */
async function showcaseInserts(context: ToolContext, cameraAssetId: string, screenAssetId: string): Promise<InsertSpec> {
  const rows = await context.db
    .select({ id: mediaAssets.id, durationS: mediaAssets.durationS })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, context.projectId), inArray(mediaAssets.id, [cameraAssetId, screenAssetId])));
  const durationOf = (assetId: string) => rows.find((row) => row.id === assetId)?.durationS ?? null;
  const [cameraS, screenS] = [durationOf(cameraAssetId), durationOf(screenAssetId)];
  if (cameraS === null || screenS === null) throw badRequest("Both files need a known duration for a showcase");
  return [{ at: 0, end: Math.min(cameraS, screenS), srcAssetId: screenAssetId, srcAt: 0 }];
}

export async function startTemplate(context: ToolContext, template: HomeTemplate, request: StartTemplateRequest): Promise<{ ingestJobId: string }> {
  checkFootageFits(template, request);
  const clips = request.clipAssetIds.map((assetId) => ({ assetId }));
  const [cameraAssetId] = request.clipAssetIds;
  const inserts =
    request.insertAssetId === undefined || cameraAssetId === undefined ? undefined : await showcaseInserts(context, cameraAssetId, request.insertAssetId);
  const ingestTool = STUDIO_TOOLS_BY_NAME.get("ingest");
  if (ingestTool === undefined) throw new Error("the ingest tool is not in the catalog");
  const result = await ingestTool.run(inserts === undefined ? { clips } : { clips, inserts }, context);
  const jobId = result.structuredContent?.["jobId"];
  if (result.isError === true || typeof jobId !== "string") {
    const [first] = result.content;
    throw badRequest(first?.type === "text" ? first.text : "The footage could not be ingested");
  }
  await writeProjectTemplate(context.db, context.projectId, { templateId: template.id, ingestMode: template.ingestMode });
  return { ingestJobId: jobId };
}
