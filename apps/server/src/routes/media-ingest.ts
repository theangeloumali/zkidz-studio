// Created by The Angelo Umali.
// The one upload path: stream to a .part, probe it, then commit it into a project. Both upload routes go through here.
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { StudioDatabase } from "@zks/db";
import { mediaAssets, projects } from "@zks/db/schema";
import { UPLOAD_FILENAME_HEADER, type MediaAsset } from "@zks/shared";
import { and, eq, isNull, sum } from "drizzle-orm";
import type { Context } from "hono";
import { projectDir } from "../config.ts";
import { toMediaAssetDto, type ProjectRow } from "../dto.ts";
import { HttpError } from "../http/http-error.ts";
import { chooseStoredExtension, probeMedia, type ProbeResult } from "../media-io/probe.ts";
import { assertFreeSpace, commitWithoutReplacing, PART_SUFFIX, UploadTooLargeError, writeCappedPart, type UploadLimits } from "../media-io/store.ts";

export interface MediaRouteDeps {
  readonly database: StudioDatabase;
  readonly studioHome: string;
  readonly ffprobePath: string;
  readonly uploadLimits: UploadLimits;
}

interface UploadRequest {
  readonly displayName: string;
  readonly declaredBytes: number;
  readonly body: ReadableStream<Uint8Array>;
}

interface StagedUpload {
  readonly assetId: string;
  readonly partPath: string;
  /** Where the file will live under its project folder: media/raw/<assetId>.<ext>. */
  readonly relPath: string;
  readonly displayName: string;
  readonly bytes: number;
  readonly probe: ProbeResult;
}

const MAX_DISPLAY_NAME_CHARS = 255;
const OWNER_ONLY_MODE = 0o700;
export const PROJECT_CAP_MESSAGE = "The upload would take this project past its storage cap";

/** The checks every upload shares before a byte is written, in the order uploadMedia has always answered them. */
export function readUploadRequest(c: Context, uploadLimits: UploadLimits): UploadRequest {
  const displayName = readDisplayName(c.req.header(UPLOAD_FILENAME_HEADER));
  const declaredBytes = Number(c.req.header("content-length") ?? 0);
  if (declaredBytes > uploadLimits.maxFileBytes) throw new UploadTooLargeError("The upload is larger than one file may be");
  const body = c.req.raw.body;
  if (body === null) throw new HttpError(400, "The upload has no body");
  return { displayName, declaredBytes, body };
}

/** Streams and probes the upload in stagingDir, hands it to `use`, and always removes the .part afterwards. */
export async function withStagedUpload<Result>(
  deps: MediaRouteDeps,
  stagingDir: string,
  upload: UploadRequest & { readonly maxBytes: number },
  use: (staged: StagedUpload) => Promise<Result>,
): Promise<Result> {
  await mkdir(stagingDir, { recursive: true, mode: OWNER_ONLY_MODE });
  await assertFreeSpace(stagingDir, deps.uploadLimits.minFreeBytes + upload.declaredBytes);
  const assetId = randomUUID();
  const partPath = join(stagingDir, `${assetId}${PART_SUFFIX}`);
  const bytes = await writeCappedPart(upload.body, partPath, upload.maxBytes);
  try {
    // A chunked body had no size to check up front; the written part now holds its share of the disk.
    await assertFreeSpace(stagingDir, deps.uploadLimits.minFreeBytes);
    const probe = await probeMedia(deps.ffprobePath, partPath);
    const relPath = `media/raw/${assetId}.${chooseStoredExtension(probe.formatName, upload.displayName)}`;
    return await use({ assetId, partPath, relPath, displayName: upload.displayName, bytes, probe });
  } finally {
    await rm(partPath, { force: true });
  }
}

/** Records the upload, then places its file; the row goes if the file cannot be placed. */
export async function commitStagedUpload(deps: MediaRouteDeps, project: ProjectRow, staged: StagedUpload): Promise<MediaAsset> {
  const asset = await insertStagedAsset(deps.database, deps, project.id, staged);
  try {
    await placeStagedFile(deps, project.slug, staged);
  } catch (error) {
    await deps.database.delete(mediaAssets).where(eq(mediaAssets.id, asset.id));
    throw error;
  }
  return asset;
}

/** The row names the path placeStagedFile will fill, so the file can be placed once no transaction is open. */
export async function insertStagedAsset(database: StudioDatabase, deps: MediaRouteDeps, projectId: string, staged: StagedUpload): Promise<MediaAsset> {
  const { mtimeMs } = await stat(staged.partPath);
  const asset = await insertWithinProjectCap(database, deps.uploadLimits.maxProjectBytes, {
    id: staged.assetId,
    projectId,
    name: staged.displayName,
    relPath: staged.relPath,
    bytes: staged.bytes,
    mtimeMs: Math.trunc(mtimeMs),
    ...probeColumns(staged.probe),
  });
  return toMediaAssetDto(asset);
}

/** Never inside a transaction: without hard links this is a full copy, and it would hold the database throughout. */
export async function placeStagedFile(deps: MediaRouteDeps, projectSlug: string, staged: StagedUpload): Promise<void> {
  const projectRoot = projectDir(deps.studioHome, projectSlug);
  await mkdir(join(projectRoot, "media", "raw"), { recursive: true });
  await commitWithoutReplacing(staged.partPath, join(projectRoot, staged.relPath));
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

export async function storedProjectBytes(database: StudioDatabase, projectId: string): Promise<number> {
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
    if ((await storedProjectBytes(transaction, row.projectId)) + row.bytes > maxProjectBytes) throw new UploadTooLargeError(PROJECT_CAP_MESSAGE);
    const [asset] = await transaction.insert(mediaAssets).values(row).returning();
    if (asset === undefined) throw new Error("media_assets insert returned no row");
    return asset;
  });
}

export function probeColumns(probe: ProbeResult) {
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
