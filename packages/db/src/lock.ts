// Created by The Angelo Umali.
// PGlite takes no directory lock, so a second server on the same data dir would corrupt it (plan §8).
import { readFile, rm, writeFile } from "node:fs/promises";

export class DatabaseLockedError extends Error {
  readonly lockPath: string;
  readonly holderPid: number;

  constructor(lockPath: string, holderPid: number) {
    super(`The database is in use by process ${holderPid} (${lockPath}). Stop that server first.`);
    this.name = "DatabaseLockedError";
    this.lockPath = lockPath;
    this.holderPid = holderPid;
  }
}

export type ReleaseLock = () => Promise<void>;

/** Creates the lock file exclusively; a lock left by a dead process is reclaimed once. */
export async function acquireProcessLock(lockPath: string): Promise<ReleaseLock> {
  const releaseLock: ReleaseLock = () => rm(lockPath, { force: true });
  try {
    await writeFile(lockPath, String(process.pid), { flag: "wx" });
    return releaseLock;
  } catch (error) {
    if (!hasErrorCode(error, "EEXIST")) throw error;
  }
  const holderPid = await readHolderPid(lockPath);
  if (holderPid !== null && isProcessAlive(holderPid)) throw new DatabaseLockedError(lockPath, holderPid);
  await rm(lockPath, { force: true });
  // "wx" again: if another process reclaimed it between our rm and here, this throws EEXIST instead of sharing the lock.
  await writeFile(lockPath, String(process.pid), { flag: "wx" });
  return releaseLock;
}

async function readHolderPid(lockPath: string): Promise<number | null> {
  const content = await readFile(lockPath, "utf8").catch(() => "");
  const holderPid = Number(content.trim());
  return Number.isSafeInteger(holderPid) && holderPid > 0 ? holderPid : null;
}

// Node's signal 0 only probes existence, on Windows too (unlike Python's os.kill, which terminates there).
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return hasErrorCode(error, "EPERM");
  }
}

export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
