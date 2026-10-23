// Created by The Angelo Umali.
// A stand-in `claude` for real-PTY tests: reports its argv and env, echoes input, exits on `EXIT <code>`, and fires the hooks its --settings names.
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";

const STUB_SOURCE = String.raw`
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const valueAfter = (flag) => { const index = args.indexOf(flag); return index === -1 ? undefined : args[index + 1]; };
const sessionId = valueAfter("--session-id") ?? valueAfter("--resume");
const settingsPath = valueAfter("--settings");
const settings = settingsPath === undefined ? undefined : JSON.parse(readFileSync(settingsPath, "utf8"));

function runSessionStart() {
  const relay = settings?.hooks?.SessionStart?.[0]?.hooks?.[0];
  if (relay === undefined) return;
  const child = spawn(relay.command, { shell: true, stdio: ["pipe", "pipe", "inherit"] });
  let relayOutput = "";
  child.stdout.on("data", (chunk) => (relayOutput += chunk));
  child.on("exit", (code) => process.stdout.write("RELAY " + JSON.stringify({ code, relayOutput }) + "\n"));
  child.stdin.end(JSON.stringify({ session_id: sessionId, hook_event_name: "SessionStart", source: "startup", model: "stub-model", permission_mode: process.env.STUB_PERMISSION_MODE ?? "default" }));
}

async function askPreToolUse(toolName) {
  const hook = settings.hooks.PreToolUse[0].hooks[0];
  const response = await fetch(hook.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + process.env.ZKS_HOOK_TOKEN },
    body: JSON.stringify({ session_id: sessionId, hook_event_name: "PreToolUse", tool_name: toolName, tool_input: {}, tool_use_id: "toolu_stub" }),
  });
  process.stdout.write("DECISION " + JSON.stringify({ status: response.status, body: await response.json() }) + "\n");
}

// Raw mode before READY: a test writes on READY, and a cooked tty would turn the paste's CR into LF.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdout.write("READY " + JSON.stringify({ argv: args, cwd: process.cwd(), envKeys: Object.keys(process.env).sort() }) + "\n");
process.stdin.on("data", (chunk) => {
  let text = chunk.toString("utf8");
  // Under load the PTY can hand over earlier input and the Esc in one read.
  const interrupted = text.endsWith("\x1b");
  if (interrupted) text = text.slice(0, -1);
  if (text !== "") onText(text);
  if (interrupted) process.stdout.write("INTERRUPTED\n");
});
function onText(text) {
  if (text.startsWith("TOOL ")) return void askPreToolUse(text.slice(5).trim());
  if (text.startsWith("EXIT ")) return void process.exit(Number(text.slice(5)));
  process.stdout.write("GOT " + JSON.stringify(text) + "\n");
}
runSessionStart();
`;

/** Writes the stub as an executable with an absolute node shebang, so it runs without PATH. */
export async function writeStubClaude(dir: string): Promise<string> {
  const stubPath = join(dir, "claude.mjs");
  await writeFile(stubPath, `#!${process.execPath}\n${STUB_SOURCE}`);
  await chmod(stubPath, 0o755);
  return stubPath;
}

export interface StubReport {
  readonly argv: string[];
  readonly cwd: string;
  readonly envKeys: string[];
}

/** What the stub printed on its READY line: the argv, cwd and env keys it was launched with. */
export function stubReport(session: { readonly pty: { snapshot(): string } }): StubReport {
  return JSON.parse(/READY (\{.*\})/.exec(session.pty.snapshot())?.[1] ?? "{}") as StubReport;
}

const WAIT_FOR_TIMEOUT_MS = 10_000;
/** Real-PTY tests outlive vitest's 5 s default, or a slow spawn under parallel load fails before waitFor gives up. */
export const REAL_PTY_TEST_TIMEOUT_MS = 2 * WAIT_FOR_TIMEOUT_MS;

export async function waitFor(predicate: () => boolean, timeoutMs = WAIT_FOR_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for the condition");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
