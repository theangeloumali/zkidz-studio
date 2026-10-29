#!/usr/bin/env node
// Created by The Angelo Umali.
// SessionStart accepts only command hooks (spike 07), so this relays the hook's stdin to the mode T HTTP bridge.
// Usage: zks-hook.mjs [--status] <bridge url>, with ZKS_HOOK_TOKEN in the env. Exit 2 is Claude Code's "blocking error".
// --status is the statusLine command: it relays the status JSON as a StatusLine payload and prints the studio's line.
const BLOCKING_EXIT_CODE = 2;
const STATUS_FLAG = "--status";
const STATUS_EVENT_NAME = "StatusLine";
// Claude Code waits on the status command before redrawing, so a slow bridge must not hold the row.
const STATUS_RELAY_TIMEOUT_MS = 2000;
const MS_PER_MINUTE = 60_000;

function fail(message) {
  process.stderr.write(`zks-hook: ${message}\n`);
  process.exit(BLOCKING_EXIT_CODE);
}

const cliArgs = process.argv.slice(2);
const isStatus = cliArgs[0] === STATUS_FLAG;
const [hookUrl] = isStatus ? cliArgs.slice(1) : cliArgs;
const hookToken = process.env.ZKS_HOOK_TOKEN;
if (hookUrl === undefined || hookToken === undefined || hookToken === "") fail("missing bridge url or ZKS_HOOK_TOKEN");

let payload = "";
for await (const chunk of process.stdin) payload += chunk;

function post(body, signal) {
  return globalThis.fetch(hookUrl, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${hookToken}` },
    body,
    signal,
  });
}

if (isStatus) await relayStatus();
else await relayHook();

async function relayHook() {
  let response;
  try {
    response = await post(payload);
  } catch {
    fail("the studio bridge is unreachable");
  }
  const answer = await response.text();
  if (!response.ok) fail(`the studio bridge refused the hook (${response.status})`);
  if (isDeny(answer)) fail("the studio denied this action");
  process.stdout.write(answer);
}

// A non-zero exit or no output blanks Claude Code's status row, so the line prints whatever the bridge does.
async function relayStatus() {
  let status = {};
  try {
    status = JSON.parse(payload);
    await post(JSON.stringify({ ...status, hook_event_name: STATUS_EVENT_NAME }), globalThis.AbortSignal.timeout(STATUS_RELAY_TIMEOUT_MS));
  } catch {
    // The usage report is best effort; the line below still shows.
  }
  process.stdout.write(`${statusLine(status.cost)}\n`);
}

function statusLine(cost) {
  const parts = ["ZKidz Studio"];
  if (typeof cost?.total_duration_ms === "number") parts.push(`${Math.max(1, Math.round(cost.total_duration_ms / MS_PER_MINUTE))} min`);
  if (typeof cost?.total_cost_usd === "number") parts.push(`≈ $${cost.total_cost_usd.toFixed(2)} estimate`);
  return parts.join(" · ");
}

function isDeny(answerText) {
  try {
    return JSON.parse(answerText)?.hookSpecificOutput?.permissionDecision === "deny";
  } catch {
    return false;
  }
}
