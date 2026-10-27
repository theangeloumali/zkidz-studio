#!/usr/bin/env node
// Created by The Angelo Umali.
// A stand-in `claude` for PTY tests: prints one scripted turn and POSTs the recorded hook payloads to ZKS_HOOK_URL.
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const HOOK_FIXTURE_DIR = new URL("../../../../tests/fixtures/hooks/", import.meta.url);
const sessionIdIndex = process.argv.indexOf("--session-id");
const sessionId = sessionIdIndex === -1 ? undefined : process.argv[sessionIdIndex + 1];
const { ZKS_HOOK_URL: hookUrl, ZKS_HOOK_TOKEN: hookToken } = process.env;

if (sessionId === undefined || hookUrl === undefined || hookToken === undefined) {
  process.stderr.write("fake-claude needs --session-id, ZKS_HOOK_URL and ZKS_HOOK_TOKEN\n");
  process.exit(2);
}

function hookPayload(eventName, overrides = {}) {
  const fixture = JSON.parse(readFileSync(new URL(`${eventName}.json`, HOOK_FIXTURE_DIR), "utf8"));
  return { ...fixture, session_id: sessionId, cwd: process.cwd(), ...overrides };
}

async function postHook(eventName, overrides) {
  const response = await globalThis.fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${hookToken}` },
    body: JSON.stringify(hookPayload(eventName, overrides)),
  });
  return response.json();
}

async function playTurn(prompt) {
  await postHook("UserPromptSubmit", { prompt });
  const toolUse = hookPayload("PreToolUse");
  process.stdout.write(`● ${toolUse.tool_name}(${JSON.stringify(toolUse.tool_input)})\n`);
  const answer = await postHook("PreToolUse");
  const decision = answer.hookSpecificOutput;
  if (decision?.permissionDecision === "deny") {
    process.stdout.write(`  ⎿  Denied: ${decision.permissionDecisionReason ?? "blocked by hook"}\n`);
  } else {
    await postHook("PostToolUse");
    process.stdout.write(`● ${hookPayload("Stop").last_assistant_message}\n`);
  }
  await postHook("Stop");
  await postHook("Notification");
}

await postHook("SessionStart");
process.stdout.write("Claude Code (fake)\n\n> ");
const lines = createInterface({ input: process.stdin, terminal: false });
for await (const line of lines) {
  if (line.trim() === "/exit") break;
  await playTurn(line);
  process.stdout.write("\n> ");
}
process.exit(0);
