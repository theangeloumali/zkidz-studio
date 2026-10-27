// Created by The Angelo Umali.
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

const PARTIAL_CONTENT = 206;

export class ChecksumMismatchError extends Error {
  constructor(url: string, expected: string, actual: string) {
    super(`SHA-256 mismatch for ${url}: expected ${expected}, got ${actual}`);
    this.name = "ChecksumMismatchError";
  }
}

export interface DownloadRequest {
  url: string;
  sha256: string;
  destination: string;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), hash);
  return hash.digest("hex");
}

/** Downloads to `<destination>.part`, resumes with Range, and renames only after the hash matches. */
export async function downloadVerified({ url, sha256, destination }: DownloadRequest): Promise<{ downloaded: boolean }> {
  if (existsSync(destination) && (await sha256File(destination)) === sha256) return { downloaded: false };
  mkdirSync(path.dirname(destination), { recursive: true });
  const partialPath = `${destination}.part`;
  const resumeFrom = existsSync(partialPath) ? statSync(partialPath).size : 0;
  const response = await fetch(url, { headers: resumeFrom > 0 ? { range: `bytes=${resumeFrom}-` } : {} });
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}) for ${url}`);
  // A server that ignores Range answers 200 with the whole file, so start over rather than append.
  const flags = response.status === PARTIAL_CONTENT ? "a" : "w";
  await pipeline(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>), createWriteStream(partialPath, { flags }));
  const actual = await sha256File(partialPath);
  if (actual !== sha256) {
    rmSync(partialPath, { force: true });
    throw new ChecksumMismatchError(url, sha256, actual);
  }
  renameSync(partialPath, destination);
  return { downloaded: true };
}
