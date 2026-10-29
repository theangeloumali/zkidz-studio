// Created by The Angelo Umali.
import { isVersionAtLeast } from "@zks/shared";
import { MIN_CLAUDE_VERSION } from "../copy/claude.ts";

/** False for an unparseable version too: the server reported something we cannot vouch for. */
export function meetsMinimumVersion(version: string, minimum = MIN_CLAUDE_VERSION): boolean {
  return isVersionAtLeast(version, minimum);
}
