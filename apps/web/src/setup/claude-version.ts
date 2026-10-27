// Created by The Angelo Umali.
import { MIN_CLAUDE_VERSION } from "../copy/claude.ts";

function versionParts(version: string): number[] | null {
  const match = /\d+(?:\.\d+)*/.exec(version);
  return match ? match[0].split(".").map(Number) : null;
}

/** False for an unparseable version too: the server reported something we cannot vouch for. */
export function meetsMinimumVersion(version: string, minimum = MIN_CLAUDE_VERSION): boolean {
  const actual = versionParts(version);
  const required = versionParts(minimum) ?? [];
  if (actual === null) return false;
  for (let index = 0; index < required.length; index += 1) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return true;
}
