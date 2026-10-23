// Created by The Angelo Umali.
// The server lists folders on its own OS, so a path may use either separator.

function separatorOf(path: string): "\\" | "/" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

function trimTrailing(path: string, separator: string): string {
  return path.endsWith(separator) ? path.slice(0, -1) : path;
}

export function joinPath(folder: string, name: string): string {
  const separator = separatorOf(folder);
  return `${trimTrailing(folder, separator)}${separator}${name}`;
}

export function parentPath(path: string): string | null {
  const separator = separatorOf(path);
  const trimmed = trimTrailing(path, separator);
  const cut = trimmed.lastIndexOf(separator);
  if (cut < 0 || trimmed === "" || /^[A-Za-z]:$/.test(trimmed)) return null;
  // Keep the root's own separator: "/home" -> "/", "C:\\Clips" -> "C:\\".
  return trimmed.slice(0, cut) === "" || /^[A-Za-z]:$/.test(trimmed.slice(0, cut)) ? trimmed.slice(0, cut + 1) : trimmed.slice(0, cut);
}
