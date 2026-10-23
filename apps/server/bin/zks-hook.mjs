#!/usr/bin/env node
// Created by The Angelo Umali.
// SessionStart accepts only command hooks (spike 07), so this relays the hook's stdin to the mode T HTTP bridge.
// Usage: zks-hook.mjs <bridge url>, with ZKS_HOOK_TOKEN in the env. Exit 2 is Claude Code's "blocking error".
const BLOCKING_EXIT_CODE = 2;

function fail(message) {
  process.stderr.write(`zks-hook: ${message}\n`);
  process.exit(BLOCKING_EXIT_CODE);
}

const [hookUrl] = process.argv.slice(2);
const hookToken = process.env.ZKS_HOOK_TOKEN;
if (hookUrl === undefined || hookToken === undefined || hookToken === "") fail("missing bridge url or ZKS_HOOK_TOKEN");

let payload = "";
for await (const chunk of process.stdin) payload += chunk;

let response;
try {
  response = await globalThis.fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${hookToken}` },
    body: payload,
  });
} catch {
  fail("the studio bridge is unreachable");
}

const answer = await response.text();
if (!response.ok) fail(`the studio bridge refused the hook (${response.status})`);
if (isDeny(answer)) fail("the studio denied this action");
process.stdout.write(answer);

function isDeny(answerText) {
  try {
    return JSON.parse(answerText)?.hookSpecificOutput?.permissionDecision === "deny";
  } catch {
    return false;
  }
}
