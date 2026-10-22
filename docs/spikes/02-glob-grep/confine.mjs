// Created by The Angelo Umali.
// Spike stand-in for the plan's §6.10 confinement helper, applied to every path-bearing Glob/Grep field.
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

// Grep's `pattern` is a regex, not a path, so only Glob's is checked.
const PATTERN_FIELDS = { Glob: ["pattern"], Grep: ["glob"] };

// UNC (`\\host`, `//host`) and device (`\\?\`, `\\.\`) prefixes: resolving one can leak the NTLM hash.
const isNetworkOrDevicePath = (value) => /^[\\/]{2}/.test(value);

// Brace alternatives (`{a,/etc}`) are checked one by one so an absolute branch cannot hide inside a relative pattern.
const isEscapingPattern = (pattern) => pattern.includes("..") || pattern.split(/[{},]/).some((fragment) => /^([\\/~]|[A-Za-z]:)/.test(fragment));

const isInsideProject = (projectDir, cwd, searchPath) => {
  if (isNetworkOrDevicePath(searchPath)) return false;
  let realSearchPath;
  try {
    realSearchPath = realpathSync(resolve(cwd, searchPath));
  } catch {
    return false;
  }
  return realSearchPath === projectDir || realSearchPath.startsWith(projectDir + sep);
};

// Returns a deny reason, or undefined when the call stays inside the project.
export function confineSearchInput(projectDir, cwd, toolName, toolInput) {
  if (!isInsideProject(projectDir, cwd, toolInput.path ?? ".")) return "path outside the project";
  for (const field of PATTERN_FIELDS[toolName] ?? []) {
    const value = toolInput[field];
    if (typeof value === "string" && isEscapingPattern(value)) return `${field} escapes the project`;
  }
  return undefined;
}
