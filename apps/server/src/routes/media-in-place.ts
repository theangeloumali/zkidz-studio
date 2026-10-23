// Created by The Angelo Umali.
// In-place files (plan §9.4) are registered by realpath, never copied. createProjectInPlace checks and records them here.
import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import { hasErrorCode, type StudioDatabase } from "@zks/db";
import { mediaAssets } from "@zks/db/schema";
import type { MediaAsset } from "@zks/shared";
import { toMediaAssetDto } from "../dto.ts";
import { checkUserPath, isWithinDir } from "../fs/path-policy.ts";
import { HttpError, notFound } from "../http/http-error.ts";
import { probeMedia, type ProbeResult } from "../media-io/probe.ts";
import { probeColumns, type MediaRouteDeps } from "./media-ingest.ts";

interface InPlaceFile {
  readonly resolvedPath: string;
  readonly bytes: number;
  readonly mtimeMs: number;
  readonly probe: ProbeResult;
}

/** Every check and the probe, before anything is written. */
export async function inspectInPlaceFile(deps: MediaRouteDeps, requestedPath: string): Promise<InPlaceFile> {
  const resolvedPath = await resolveExistingPath(checkUserPath(requestedPath));
  if (isWithinDir(resolvedPath, await realpath(deps.studioHome))) throw new HttpError(400, "Files inside the studio folder cannot be registered");
  const fileStats = await stat(resolvedPath);
  if (!fileStats.isFile()) throw new HttpError(400, "Only a single file can be registered in place");
  const probe = await probeMedia(deps.ffprobePath, resolvedPath);
  return { resolvedPath, bytes: fileStats.size, mtimeMs: Math.trunc(fileStats.mtimeMs), probe };
}

export async function insertInPlaceAsset(database: StudioDatabase, projectId: string, file: InPlaceFile): Promise<MediaAsset> {
  const [asset] = await database
    .insert(mediaAssets)
    .values({
      projectId,
      name: basename(file.resolvedPath),
      inPlacePath: file.resolvedPath,
      bytes: file.bytes,
      mtimeMs: file.mtimeMs,
      ...probeColumns(file.probe),
    })
    .returning();
  if (asset === undefined) throw new Error("media_assets insert returned no row");
  return toMediaAssetDto(asset);
}

export async function resolveExistingPath(checkedPath: string): Promise<string> {
  try {
    return await realpath(checkedPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) throw notFound();
    throw error;
  }
}
