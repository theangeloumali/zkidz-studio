// Created by The Angelo Umali.
// Path confinement for every user-supplied path (plan §9.4, §11): lexical checks first, then realpath containment.
import { constants } from "node:fs";
import { open, realpath, stat, type FileHandle } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type PathEscapeReason =
  | "nul-byte"
  | "encoded-sequence"
  | "windows-path-form"
  | "parent-segment"
  | "trailing-dot-or-space"
  | "reserved-name"
  | "unresolvable"
  | "outside-root"
  | "not-a-file"
  | "changed-during-open";

export class PathEscapeError extends Error {
  override readonly name = "PathEscapeError";
  readonly reason: PathEscapeReason;

  constructor(reason: PathEscapeReason) {
    // The message never carries either path, so it is safe to return to the browser.
    super(`Path rejected: ${reason}`);
    this.reason = reason;
  }
}

const IS_WINDOWS = process.platform === "win32";
// %25 catches double encoding; %2e, %2f, %5c and %00 decode to traversal or truncation.
const ENCODED_SEQUENCE = /%(?:25|2e|2f|5c|00)/i;
const UNC_OR_DEVICE_PREFIX = /^[\\/]{2}/;
const WINDOWS_DRIVE_PREFIX = /^[a-z]:[\\/]/i;
// Windows opens the device for these names whatever the extension or trailing spaces.
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[0-9¹²³]|lpt[0-9¹²³])$/i;

export async function confinePath(rootDir: string, candidatePath: string): Promise<string> {
  const lexicalViolation = findLexicalViolation(candidatePath);
  if (lexicalViolation !== null) throw new PathEscapeError(lexicalViolation);
  return resolveWithinRoot(rootDir, candidatePath);
}

async function resolveWithinRoot(rootDir: string, candidatePath: string): Promise<string> {
  const rootRealPath = await realpathOrReject(rootDir);
  const candidateRealPath = await realpathOrReject(resolve(rootRealPath, candidatePath));
  if (!isWithinRoot(rootRealPath, candidateRealPath)) throw new PathEscapeError("outside-root");
  return candidateRealPath;
}

function findLexicalViolation(candidatePath: string): PathEscapeReason | null {
  if (candidatePath.includes("\0")) return "nul-byte";
  if (ENCODED_SEQUENCE.test(candidatePath)) return "encoded-sequence";
  if (UNC_OR_DEVICE_PREFIX.test(candidatePath)) return "windows-path-form";
  // After an own-drive prefix, any colon is an alternate data stream or a drive-relative path.
  const pathAfterDrive = IS_WINDOWS ? candidatePath.replace(WINDOWS_DRIVE_PREFIX, "") : candidatePath;
  if (pathAfterDrive.includes(":")) return "windows-path-form";

  for (const segment of pathAfterDrive.split(/[\\/]/)) {
    const segmentViolation = findSegmentViolation(segment);
    if (segmentViolation !== null) return segmentViolation;
  }
  return null;
}

function findSegmentViolation(segment: string): PathEscapeReason | null {
  if (segment === "" || segment === ".") return null;
  if (segment === "..") return "parent-segment";
  // Windows drops trailing dots and spaces, so "clip.mp4." aliases "clip.mp4".
  if (/[. ]$/.test(segment)) return "trailing-dot-or-space";
  const baseName = (segment.split(".")[0] ?? "").trimEnd();
  if (RESERVED_DEVICE_NAME.test(baseName)) return "reserved-name";
  return null;
}

export interface ConfinedFile {
  readonly handle: FileHandle;
  readonly realPath: string;
}

// O_NOFOLLOW refuses a final-component link swapped in after the check; O_NONBLOCK stops a planted FIFO hanging the open.
// Both are undefined on Windows, where the post-open check alone carries the guarantee.
const OPEN_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);

/**
 * confinePath, then open and prove the opened inode is still the one the root holds at that path. Reading through the
 * returned handle closes the check-then-open race a path string leaves; the caller closes the handle.
 */
export async function openConfined(rootDir: string, candidatePath: string): Promise<ConfinedFile> {
  const realPath = await confinePath(rootDir, candidatePath);
  const handle = await open(realPath, OPEN_FLAGS).catch(() => {
    throw new PathEscapeError("changed-during-open");
  });
  try {
    await assertOpenedInsideRoot(rootDir, realPath, handle);
    return { handle, realPath };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function assertOpenedInsideRoot(rootDir: string, realPath: string, handle: FileHandle): Promise<void> {
  const openedStats = await handle.stat();
  if (!openedStats.isFile()) throw new PathEscapeError("not-a-file");
  // Resolving again after the open is what makes this race-free: a swap before the open shows here as outside-root.
  const recheckedPath = await resolveWithinRoot(rootDir, realPath);
  const recheckedStats = await stat(recheckedPath).catch(() => null);
  if (recheckedPath !== realPath || recheckedStats?.dev !== openedStats.dev || recheckedStats.ino !== openedStats.ino) {
    throw new PathEscapeError("changed-during-open");
  }
}

async function realpathOrReject(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    // A path we cannot resolve cannot be proven inside the root.
    throw new PathEscapeError("unresolvable");
  }
}

// Both sides are realpaths, so casing is already canonical; folding it would admit a case-sensitive sibling on Windows.
function isWithinRoot(rootRealPath: string, candidateRealPath: string): boolean {
  // Separator-bounded, so /projects/a never admits /projects/a-evil.
  const rootWithSeparator = rootRealPath.endsWith(sep) ? rootRealPath : rootRealPath + sep;
  return candidateRealPath === rootRealPath || candidateRealPath.startsWith(rootWithSeparator);
}
