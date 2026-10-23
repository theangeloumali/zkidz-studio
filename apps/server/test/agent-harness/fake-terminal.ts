// Created by The Angelo Umali.
// Launches fake-claude.mjs in place of the real `claude` binary, so terminal tests drive a PTY without an account.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HookPayloadSchema, type HOOK_EVENT_NAMES, type HookPayload } from "@zks/shared";

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

const HOOK_FIXTURE_DIR = new URL("../../../../tests/fixtures/hooks/", import.meta.url);

const FAKE_CLAUDE_SCRIPT = fileURLToPath(new URL("fake-claude.mjs", import.meta.url));

/** The command and args a PTY spawns in place of `claude`; append the real CLI flags (e.g. `--session-id`). */
export function fakeClaudeCommand(): { readonly command: string; readonly args: readonly string[] } {
  return { command: process.execPath, args: [FAKE_CLAUDE_SCRIPT] };
}

/** The recorded payload Claude Code sends for this hook event. */
export function readHookFixture(eventName: HookEventName): HookPayload {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${eventName}.json`, HOOK_FIXTURE_DIR), "utf8"));
  return HookPayloadSchema.parse(raw);
}
