// Created by The Angelo Umali.
// The project behind a ToolContext and its media, addressed by assetId only (plan §6.8).
import { mediaAssets, projects } from "@zks/db/schema";
import { and, eq } from "drizzle-orm";
import { join } from "node:path";
import { projectDir } from "../config.ts";
import type { MediaAssetRow, ProjectRow } from "../dto.ts";
import type { ToolContext } from "./context.ts";
import { ToolError } from "./result.ts";

/** Projects have no theme column yet, so every one uses the default pack (plan §7.8). */
export const PROJECT_THEME_ID = "zkidz";

export async function loadProject(context: ToolContext): Promise<ProjectRow> {
  const [project] = await context.db.select().from(projects).where(eq(projects.id, context.projectId));
  if (project === undefined) throw new ToolError("This project no longer exists");
  return project;
}

export function projectRootOf(context: ToolContext, project: ProjectRow): string {
  return projectDir(context.studioHome, project.slug);
}

export async function findProjectAsset(context: ToolContext, assetId: string): Promise<MediaAssetRow> {
  const [asset] = await context.db
    .select()
    .from(mediaAssets)
    .where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.projectId, context.projectId)));
  if (asset === undefined) throw new ToolError(`Asset ${assetId} is not part of this project`);
  return asset;
}

/** An upload lives under the project folder; an in-place file is the realpath registered at pick time. */
export function assetFilePath(projectRoot: string, asset: MediaAssetRow): string {
  if (asset.relPath !== null) return join(projectRoot, asset.relPath);
  if (asset.inPlacePath !== null) return asset.inPlacePath;
  throw new ToolError(`Asset ${asset.id} has no file`);
}
