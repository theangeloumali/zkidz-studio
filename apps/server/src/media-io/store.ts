// Created by The Angelo Umali.
// Upload storage (plan §9.4): stream to a private .part file under a byte cap, then commit without ever replacing a file.
import { constants } from "node:fs";
import { copyFile, link, open, readdir, rm, stat, statfs, utimes } from "node:fs/promises";
import { join } from "node:path";
import { hasErrorCode } from "@zks/db";
import { projectDir } from "../config.ts";

export interface UploadLimits {
  readonly maxFileBytes: number;
  readonly maxProjectBytes: number;
  /** Free space the disk must keep after an upload, so a render still has room to write. */
  readonly minFreeBytes: number;
}

/** Under studioHome but outside projects/, so a rejected first upload never touches the projects folder. */
export const INCOMING_DIR = "incoming";
export const PART_SUFFIX = ".part";

const GIB = 1024 ** 3;
export const DEFAULT_UPLOAD_LIMITS: UploadLimits = { maxFileBytes: 256 * GIB, maxProjectBytes: 2048 * GIB, minFreeBytes: 2 * GIB };

export class UploadTooLargeError extends Error {
  override readonly name = "UploadTooLargeError";
}

export class DiskFullError extends Error {
  override readonly name = "DiskFullError";
}

/** Returns the bytes written; deletes the part file on any failure, including the cap. */
export async function writeCappedPart(body: ReadableStream<Uint8Array>, partPath: string, maxBytes: number): Promise<number> {
  const partFile = await open(partPath, "wx", 0o600);
  let writtenBytes = 0;
  try {
    try {
      for await (const chunk of body) {
        writtenBytes += chunk.byteLength;
        if (writtenBytes > maxBytes) throw new UploadTooLargeError("The upload is larger than this project allows");
        await partFile.write(chunk);
      }
    } finally {
      await partFile.close();
    }
  } catch (error) {
    await rm(partPath, { force: true });
    throw error;
  }
  return writtenBytes;
}

/** link() fails with EEXIST instead of replacing; copyFile with COPYFILE_EXCL covers filesystems without hard links. */
export async function commitWithoutReplacing(partPath: string, finalPath: string): Promise<void> {
  try {
    await link(partPath, finalPath);
  } catch (error) {
    if (hasErrorCode(error, "EEXIST")) throw error;
    await copyWithoutReplacing(partPath, finalPath);
  }
  await rm(partPath, { force: true });
}

/** The copy keeps the part's mtime, which the asset row already recorded. A failed copy is removed unless it was never ours. */
async function copyWithoutReplacing(partPath: string, finalPath: string): Promise<void> {
  try {
    await copyFile(partPath, finalPath, constants.COPYFILE_EXCL);
    // Seconds, not stat's Dates: those round to the millisecond, and the row truncates.
    const { atimeMs, mtimeMs } = await stat(partPath);
    await utimes(finalPath, atimeMs / 1000, mtimeMs / 1000);
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) await rm(finalPath, { force: true });
    throw error;
  }
}

export async function assertFreeSpace(dir: string, requiredBytes: number): Promise<void> {
  const disk = await statfs(dir);
  if (disk.bavail * disk.bsize < requiredBytes) throw new DiskFullError("Not enough free disk space for this upload");
}

/** Startup only: a .part lives just as long as its request, so any found before serving was left by a crash. */
export async function removeStaleParts(studioHome: string): Promise<void> {
  const projectSlugs = await readdirIfPresent(join(studioHome, "projects"));
  const stagingDirs = [join(studioHome, INCOMING_DIR), ...projectSlugs.map((slug) => join(projectDir(studioHome, slug), "media", "raw"))];
  for (const dir of stagingDirs) {
    const staleParts = (await readdirIfPresent(dir)).filter((name) => name.endsWith(PART_SUFFIX));
    await Promise.all(staleParts.map((name) => rm(join(dir, name), { force: true })));
  }
}

async function readdirIfPresent(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT") || hasErrorCode(error, "ENOTDIR")) return [];
    throw error;
  }
}
