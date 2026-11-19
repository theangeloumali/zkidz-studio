// Created by The Angelo Umali.
// Copies finished deliverables into ZKS_EXPORT_DIR/<project-slug>/ for another app to pick up.
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, realpath, rename, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { Logger } from "../logging/logger.ts";
import { openConfined } from "../security/confine-path.ts";
import { createHashingStream } from "./hashing-stream.ts";

export interface ExportCopyTarget {
  readonly dir: string;
  readonly logger: Logger;
}

interface ExportCopyRequest {
  readonly exportDir: string;
  readonly projectRoot: string;
  readonly slug: string;
  /** Each deliverable's project-relative path and the SHA-256 recorded when it passed QC. */
  readonly deliverables: readonly { readonly path: string; readonly sha256: string }[];
  readonly signal?: AbortSignal;
}

// The reading app shares the group or the uid; nobody else needs the files.
const EXPORT_DIR_MODE = 0o750;
const EXPORT_FILE_MODE = 0o640;

export async function copyToExportDir(request: ExportCopyRequest): Promise<void> {
  const slugDir = await prepareSlugDir(request.exportDir, request.slug);
  for (const deliverable of request.deliverables) await copyVerified(request, slugDir, deliverable);
}

/** The export folder is shared with another app, so a planted symlink must not redirect where Studio writes. */
async function prepareSlugDir(exportDir: string, slug: string): Promise<string> {
  if (basename(slug) !== slug) throw new Error(`Project slug "${slug}" is not a single folder name`);
  const slugDir = join(exportDir, slug);
  await mkdir(slugDir, { mode: EXPORT_DIR_MODE }).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  });
  const stats = await lstat(slugDir);
  if (stats.isSymbolicLink()) throw new Error(`${slugDir} is a symlink; refusing to export through it`);
  if (!stats.isDirectory()) throw new Error(`${slugDir} is not a folder`);
  const [realSlugDir, realExportDir] = await Promise.all([realpath(slugDir), realpath(exportDir)]);
  if (realSlugDir !== join(realExportDir, slug)) throw new Error(`${slugDir} resolves outside ${exportDir}`);
  return realSlugDir;
}

/** The temp name starts with a dot, so a folder watcher skips it until the rename lands the whole, verified file. */
async function copyVerified(request: ExportCopyRequest, slugDir: string, deliverable: ExportCopyRequest["deliverables"][number]): Promise<void> {
  const name = basename(deliverable.path);
  const partPath = join(slugDir, `.${name}.${randomUUID()}.part`);
  const { handle } = await openConfined(request.projectRoot, deliverable.path);
  try {
    const hashing = createHashingStream();
    const target = createWriteStream(partPath, { flags: "wx", mode: EXPORT_FILE_MODE });
    await pipeline(handle.createReadStream({ autoClose: false }), hashing.stream, target, request.signal === undefined ? {} : { signal: request.signal });
    if (hashing.digest() !== deliverable.sha256) throw new Error(`${name} no longer matches the SHA-256 it was exported with`);
    request.signal?.throwIfAborted();
    await rename(partPath, join(slugDir, name));
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}
