// Created by The Angelo Umali.
// The oldest agent CLI each lockdown was checked against, and the one comparison the server, web and CLI share.
import type { AgentKind } from "./enums.ts";

/** Claude 2.1.295 added onFailure on HTTP hooks, which mode T relies on (plan §6.3). */
export const AGENT_MIN_VERSIONS: Readonly<Record<AgentKind, string>> = { claude: "2.1.295", codex: "0.164.0", opencode: "2.2.0" };

/** Compares major.minor.patch; a pre-release counts as its release, and an unreadable version is never enough. */
export function isVersionAtLeast(version: string, minVersion: string): boolean {
  const actual = parseVersion(version);
  const minimum = parseVersion(minVersion);
  if (actual === null || minimum === null) return false;
  for (const [index, part] of actual.entries()) {
    const minimumPart = minimum[index] ?? 0;
    if (part !== minimumPart) return part > minimumPart;
  }
  return true;
}

function parseVersion(version: string): readonly number[] | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match === null ? null : match.slice(1).map(Number);
}
