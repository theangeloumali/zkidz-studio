// Created by The Angelo Umali.
// The spec file the engine reads, and the snapshot of what it held before each write.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hasErrorCode } from "@zks/db";
import type { SpecKind } from "@zks/shared";
import { createKeyedQueue } from "./keyed-queue.ts";

export interface SpecAddress {
  readonly videoId: string;
  readonly kind: SpecKind;
}

export const specRelPath = (address: SpecAddress) => `work/${address.kind}/${address.videoId}.json`;

/** work/versions/<kind>/<videoId>.v<N>.json: the file as version N left it, kept even if the row is lost. */
export const snapshotRelPath = (address: SpecAddress, version: number) => `work/versions/${address.kind}/${address.videoId}.v${version}.json`;

const runSpecQueued = createKeyedQueue();

/** Agent writes and restores of one spec run one at a time, so its file lands in version order. */
export function withSpecLock<Output>(projectId: string, address: SpecAddress, task: () => Promise<Output>): Promise<Output> {
  return runSpecQueued(`${projectId}/${address.videoId}/${address.kind}`, task);
}

export interface SpecFileChange {
  readonly previousVersion: number;
  readonly version: number;
  readonly specText: string;
}

/**
 * Snapshots the file previousVersion left, then renames the new text over it. The current version is read again just
 * before the rename: a newer one (another server process) keeps its file, and this write returns false.
 */
export async function replaceSpecFile(
  projectRoot: string,
  address: SpecAddress,
  change: SpecFileChange,
  readCurrentVersion: () => Promise<number | undefined>,
): Promise<boolean> {
  await snapshotSpecFile(projectRoot, address, change.previousVersion);
  return writeFileIf(join(projectRoot, specRelPath(address)), change.specText, async () => (await readCurrentVersion()) === change.version);
}

/** A spec that was never written has nothing to keep. */
async function snapshotSpecFile(projectRoot: string, address: SpecAddress, version: number): Promise<void> {
  const snapshotPath = join(projectRoot, snapshotRelPath(address, version));
  await mkdir(dirname(snapshotPath), { recursive: true });
  try {
    await copyFile(join(projectRoot, specRelPath(address)), snapshotPath);
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
}

// The engine may read the file at any moment, so it never sees a half-written one. A unique part name per write: two
// writers of one file in this process must never share a part file.
export async function writeFileAtomically(filePath: string, text: string): Promise<void> {
  await writeFileIf(filePath, text, () => Promise.resolve(true));
}

async function writeFileIf(filePath: string, text: string, shouldReplace: () => Promise<boolean>): Promise<boolean> {
  await mkdir(dirname(filePath), { recursive: true });
  const partPath = `${filePath}.${randomUUID()}.part`;
  await writeFile(partPath, text, { mode: 0o600 });
  if (!(await shouldReplace())) {
    await rm(partPath, { force: true });
    return false;
  }
  await rename(partPath, filePath);
  return true;
}
