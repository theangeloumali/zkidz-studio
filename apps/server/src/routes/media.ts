// Created by The Angelo Umali.
// Media intake (plan §9.4): streamed uploads become <assetId>.<ext>; in-place files are registered by realpath, never copied.
import { randomUUID } from "node:crypto";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { hasErrorCode, type StudioDatabase } from "@zks/db";
import { mediaAssets, projects } from "@zks/db/schema";
import { API_ROUTES, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { and, asc, eq, isNull, sum } from "drizzle-orm";
import type { Hono } from "hono";
import { projectDir } from "../config.ts";
import { toMediaAssetDto, type ProjectRow } from "../dto.ts";
import { checkUserPath, isWithinDir } from "../fs/path-policy.ts";
import { HttpError, notFound, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import { assertLoopbackPeer } from "../http/loopback-peer.ts";
import { chooseStoredExtension, probeMedia, type ProbeResult } from "../media-io/probe.ts";
import { assertFreeSpace, commitWithoutReplacing, UploadTooLargeError, writeCappedPart, type UploadLimits } from "../media-io/store.ts";
import { findProjectOrThrow } from "../projects/project-store.ts";

export interface MediaRouteDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly ffprobePath: string;
  readonly uploadLimits: UploadLimits;
}

const MAX_DISPLAY_NAME_CHARS = 255;

export function registerMediaRoutes(app: Hono, deps: MediaRouteDeps): void {
  /** Declared bytes of uploads still streaming, per project: the DB only counts finished ones. */
  const inFlightBytes = new Map<string, number>();

  app.get(API_ROUTES.listMedia.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const rows = await deps.database.select().from(mediaAssets).where(eq(mediaAssets.projectId, project.id)).orderBy(asc(mediaAssets.createdAt));
    return c.json({ assets: rows.map(toMediaAssetDto) });
  });

  app.post(API_ROUTES.uploadMedia.path, async (c) => {
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const displayName = readDisplayName(c.req.header(UPLOAD_FILENAME_HEADER));
    const declaredBytes = Number(c.req.header("content-length") ?? 0);
    if (declaredBytes > deps.uploadLimits.maxFileBytes) throw new UploadTooLargeError("The upload is larger than one file may be");
    const body = c.req.raw.body;
    if (body === null) throw new HttpError(400, "The upload has no body");

    const storedBytes = await storedProjectBytes(deps.database, project.id);
    // Read and reserve with no await in between, so a parallel upload always sees this reservation.
    const remainingProjectBytes = deps.uploadLimits.maxProjectBytes - storedBytes - (inFlightBytes.get(project.id) ?? 0);
    if (declaredBytes > remainingProjectBytes) throw new UploadTooLargeError("The upload would take this project past its storage cap");
    inFlightBytes.set(project.id, (inFlightBytes.get(project.id) ?? 0) + declaredBytes);
    try {
      return c.json(
        await storeUpload({ project, displayName, declaredBytes, body, maxBytes: Math.min(deps.uploadLimits.maxFileBytes, remainingProjectBytes) }),
        201,
      );
    } finally {
      const stillInFlight = (inFlightBytes.get(project.id) ?? 0) - declaredBytes;
      if (stillInFlight > 0) inFlightBytes.set(project.id, stillInFlight);
      else inFlightBytes.delete(project.id);
    }
  });

  async function storeUpload(upload: { project: ProjectRow; displayName: string; declaredBytes: number; body: ReadableStream<Uint8Array>; maxBytes: number }) {
    const projectRoot = projectDir(deps.studioHome, upload.project.slug);
    const rawDir = join(projectRoot, "media", "raw");
    await mkdir(rawDir, { recursive: true });
    await assertFreeSpace(rawDir, deps.uploadLimits.minFreeBytes + upload.declaredBytes);

    const assetId = randomUUID();
    const partPath = join(rawDir, `${assetId}.part`);
    const bytes = await writeCappedPart(upload.body, partPath, upload.maxBytes);
    let relPath: string;
    let probe: ProbeResult;
    try {
      // A chunked body had no size to check up front; the written part now holds its share of the disk.
      await assertFreeSpace(rawDir, deps.uploadLimits.minFreeBytes);
      probe = await probeMedia(deps.ffprobePath, partPath);
      relPath = `media/raw/${assetId}.${chooseStoredExtension(probe.formatName, upload.displayName)}`;
      await commitWithoutReplacing(partPath, join(projectRoot, relPath));
    } finally {
      await rm(partPath, { force: true });
    }

    const finalPath = join(projectRoot, relPath);
    try {
      const { mtimeMs } = await stat(finalPath);
      const asset = await insertWithinProjectCap(deps.database, deps.uploadLimits.maxProjectBytes, {
        id: assetId,
        projectId: upload.project.id,
        name: upload.displayName,
        relPath,
        bytes,
        mtimeMs: Math.trunc(mtimeMs),
        ...probeColumns(probe),
      });
      return toMediaAssetDto(asset);
    } catch (error) {
      await rm(finalPath, { force: true });
      throw error;
    }
  }

  app.post(API_ROUTES.registerInPlace.path, async (c) => {
    assertLoopbackPeer(c);
    const project = await findProjectOrThrow(deps.database, c.req.param("projectId"));
    const { path: requestedPath } = parseOrBadRequest(API_ROUTES.registerInPlace.body, await readJsonBody(c));
    const resolvedPath = await resolveExistingPath(checkUserPath(requestedPath));
    if (isWithinDir(resolvedPath, await realpath(deps.studioHome))) throw new HttpError(400, "Files inside the studio folder cannot be registered");
    const fileStats = await stat(resolvedPath);
    if (!fileStats.isFile()) throw new HttpError(400, "Only a single file can be registered in place");

    const probe = await probeMedia(deps.ffprobePath, resolvedPath);
    const [asset] = await deps.database
      .insert(mediaAssets)
      .values({
        projectId: project.id,
        name: basename(resolvedPath),
        inPlacePath: resolvedPath,
        bytes: fileStats.size,
        mtimeMs: Math.trunc(fileStats.mtimeMs),
        ...probeColumns(probe),
      })
      .returning();
    if (asset === undefined) throw new Error("media_assets insert returned no row");
    return c.json(toMediaAssetDto(asset), 201);
  });
}

/** Display text only: the stored name is always <assetId>.<ext>, so this never reaches the filesystem. */
function readDisplayName(rawHeader: string | undefined): string {
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawHeader ?? "");
  } catch {
    throw new HttpError(400, `${UPLOAD_FILENAME_HEADER} is not valid percent-encoding`);
  }
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const displayName = (decodedName.split(/[\\/]/).at(-1) ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (displayName === "") throw new HttpError(400, `${UPLOAD_FILENAME_HEADER} must name the file`);
  return displayName.slice(0, MAX_DISPLAY_NAME_CHARS);
}

async function storedProjectBytes(database: StudioDatabase, projectId: string): Promise<number> {
  const [usage] = await database
    .select({ storedBytes: sum(mediaAssets.bytes).mapWith(Number) })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.projectId, projectId), isNull(mediaAssets.inPlacePath)));
  return usage?.storedBytes ?? 0;
}

/** The project row lock serialises the final cap check, so chunked uploads (nothing reserved) cannot both fit. */
async function insertWithinProjectCap(database: StudioDatabase, maxProjectBytes: number, row: typeof mediaAssets.$inferInsert) {
  return database.transaction(async (transaction) => {
    await transaction.select({ id: projects.id }).from(projects).where(eq(projects.id, row.projectId)).for("update");
    if ((await storedProjectBytes(transaction, row.projectId)) + row.bytes > maxProjectBytes) {
      throw new UploadTooLargeError("The upload would take this project past its storage cap");
    }
    const [asset] = await transaction.insert(mediaAssets).values(row).returning();
    if (asset === undefined) throw new Error("media_assets insert returned no row");
    return asset;
  });
}

export async function resolveExistingPath(checkedPath: string): Promise<string> {
  try {
    return await realpath(checkedPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) throw notFound();
    throw error;
  }
}

function probeColumns(probe: ProbeResult) {
  return {
    kind: probe.kind,
    durationS: probe.durationS,
    width: probe.width,
    height: probe.height,
    fpsNum: probe.fps?.num ?? null,
    fpsDen: probe.fps?.den ?? null,
    isHdr: probe.isHdr,
    probe: {
      formatName: probe.formatName,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      rotation: probe.rotation,
      colorTransfer: probe.colorTransfer,
    },
  };
}
