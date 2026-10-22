// Created by The Angelo Umali.
// Path confinement for every user-supplied path (plan §9.4, §11): lexical checks first, then realpath containment.
import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";

export type PathEscapeReason =
  "nul-byte" | "encoded-sequence" | "windows-path-form" | "parent-segment" | "trailing-dot-or-space" | "reserved-name" | "unresolvable" | "outside-root";

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

async function realpathOrReject(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    // A path we cannot resolve cannot be proven inside the root.
    throw new PathEscapeError("unresolvable");
  }
}

function isWithinRoot(rootRealPath: string, candidateRealPath: string): boolean {
  const root = IS_WINDOWS ? rootRealPath.toLowerCase() : rootRealPath;
  const candidate = IS_WINDOWS ? candidateRealPath.toLowerCase() : candidateRealPath;
  // Separator-bounded, so /projects/a never admits /projects/a-evil.
  const rootWithSeparator = root.endsWith(sep) ? root : root + sep;
  return candidate === root || candidate.startsWith(rootWithSeparator);
}
