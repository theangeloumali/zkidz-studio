// Created by The Angelo Umali.
// Rules for any path a user types (plan §9.4). Windows rules apply on every OS: the engine and the files cross to Windows.
import { isAbsolute, relative, sep } from "node:path";

export class UserPathError extends Error {
  override readonly name = "UserPathError";
}

const MAX_PATH_CHARS = 4096;
const DRIVE_ABSOLUTE = /^[A-Za-z]:[\\/]/;
/** `.` or `..` with any dot still percent-encoded: a later decode (a URL, a shell) would turn it into a traversal. */
const DOT_SEGMENT = /^(?:\.|%2e){1,2}$/i;
const RESERVED_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

export function checkUserPath(candidatePath: string): string {
  if (candidatePath === "" || candidatePath.length > MAX_PATH_CHARS) throw new UserPathError("Path is empty or too long");
  if (candidatePath.includes("\0")) throw new UserPathError("Path contains a NUL byte");
  // Covers UNC shares and the \\.\ and \\?\ device namespaces.
  if (/^[\\/]{2}/.test(candidatePath)) throw new UserPathError("Network and device paths are not allowed");
  const hasDrive = DRIVE_ABSOLUTE.test(candidatePath);
  if (!hasDrive && !candidatePath.startsWith("/")) throw new UserPathError("Path must be absolute");

  const pathAfterDrive = hasDrive ? candidatePath.slice(2) : candidatePath;
  if (pathAfterDrive.includes(":")) throw new UserPathError("Alternate data streams are not allowed");
  for (const segment of pathAfterDrive.split(/[\\/]/)) checkSegment(segment);
  return candidatePath;
}

function checkSegment(segment: string): void {
  if (segment === "") return;
  if (DOT_SEGMENT.test(segment)) throw new UserPathError("Relative segments are not allowed");
  if (RESERVED_DEVICE_NAME.test(segment)) throw new UserPathError(`"${segment}" is a reserved device name`);
  if (/[. ]$/.test(segment)) throw new UserPathError("Names may not end in a dot or a space");
}

export function isWithinDir(candidatePath: string, dir: string): boolean {
  const relativePath = relative(dir, candidatePath);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}
