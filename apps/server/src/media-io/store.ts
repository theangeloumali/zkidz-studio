// Created by The Angelo Umali.
// Upload storage (plan §9.4): stream to a private .part file under a byte cap, then commit without ever replacing a file.
import { constants } from "node:fs";
import { copyFile, link, open, rm, statfs } from "node:fs/promises";
import { hasErrorCode } from "@zks/db";

export interface UploadLimits {
  readonly maxFileBytes: number;
  readonly maxProjectBytes: number;
  /** Free space the disk must keep after an upload, so a render still has room to write. */
  readonly minFreeBytes: number;
}

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
    await copyFile(partPath, finalPath, constants.COPYFILE_EXCL);
  }
  await rm(partPath, { force: true });
}

export async function assertFreeSpace(dir: string, requiredBytes: number): Promise<void> {
  const disk = await statfs(dir);
  if (disk.bavail * disk.bsize < requiredBytes) throw new DiskFullError("Not enough free disk space for this upload");
}
