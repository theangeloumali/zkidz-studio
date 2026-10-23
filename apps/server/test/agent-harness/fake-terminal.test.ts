// Created by The Angelo Umali.
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import { HookPayloadSchema, HOOK_EVENT_NAMES } from "@zks/shared";
import { spawn } from "node-pty";
import { afterEach, describe, expect, it } from "vitest";
import { fakeClaudeCommand, readHookFixture } from "./fake-terminal.ts";

const SESSION_ID = "00000000-0000-4000-8000-0000000000aa";
const HOOK_TOKEN = "test-hook-token";
const PROMPT = "Render the 4K master.";

interface ReceivedHook {
  readonly headers: IncomingHttpHeaders;
  readonly body: Record<string, unknown>;
}

type PreToolUseAnswer = "allow" | "deny";

let bridge: Server | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

afterEach(() => {
  bridge?.close();
  bridge = undefined;
});

/** A stand-in for the studio's hook bridge: records each POST and answers PreToolUse. */
async function startBridge(answer: PreToolUseAnswer): Promise<{ url: string; received: ReceivedHook[] }> {
  const received: ReceivedHook[] = [];
  bridge = createServer((request, response) => {
    let rawBody = "";
    request.on("data", (chunk: Buffer) => (rawBody += chunk.toString("utf8")));
    request.on("end", () => {
      const body: unknown = JSON.parse(rawBody);
      if (!isRecord(body)) throw new Error("hook body is not an object");
      received.push({ headers: request.headers, body });
      const isPreToolUse = body.hook_event_name === "PreToolUse";
      const decision = { hookEventName: "PreToolUse", permissionDecision: answer, permissionDecisionReason: "Rendering is paused." };
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(isPreToolUse ? { hookSpecificOutput: decision } : {}));
    });
  });
  await new Promise<void>((resolve) => bridge?.listen(0, "127.0.0.1", resolve));
  const address = bridge.address();
  if (address === null || typeof address === "string") throw new Error("bridge is not listening on a TCP port");
  const { port } = address;
  return { url: `http://127.0.0.1:${port}/hooks`, received };
}

/** Runs one scripted turn in a real PTY: type the prompt, wait for the next prompt marker, then /exit. */
async function runTurn(hookUrl: string): Promise<{ output: string; exitCode: number }> {
  const { command, args } = fakeClaudeCommand();
  const terminal = spawn(command, [...args, "--session-id", SESSION_ID], {
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: { ...process.env, ZKS_HOOK_URL: hookUrl, ZKS_HOOK_TOKEN: HOOK_TOKEN },
  });
  let output = "";
  let promptsSeen = 0;
  terminal.onData((data) => {
    output += data;
    const prompts = output.split("\n> ").length - 1;
    if (prompts === promptsSeen) return;
    promptsSeen = prompts;
    terminal.write(promptsSeen === 1 ? `${PROMPT}\r` : "/exit\r");
  });
  const exitCode = await new Promise<number>((resolve) => terminal.onExit(({ exitCode: code }) => resolve(code)));
  return { output, exitCode };
}

describe("FakeTerminal plays a scripted Claude Code session in a real PTY", () => {
  it("posts every hook event, in Claude Code's order, with the bearer token", async () => {
    const { url, received } = await startBridge("allow");

    const { exitCode } = await runTurn(url);

    expect(exitCode).toBe(0);
    expect(received.map(({ body }) => body.hook_event_name)).toEqual(["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop", "Notification"]);
    expect([...new Set(received.map(({ body }) => body.hook_event_name))].sort()).toEqual([...HOOK_EVENT_NAMES].sort());
    expect(received.every(({ headers }) => headers.authorization === `Bearer ${HOOK_TOKEN}`)).toBe(true);
  });

  it("sends the recorded fixtures with this session's id, cwd and typed prompt", async () => {
    const { url, received } = await startBridge("allow");

    await runTurn(url);

    for (const { body } of received) {
      expect(HookPayloadSchema.safeParse(body).success).toBe(true);
      const eventName = HOOK_EVENT_NAMES.find((name) => name === body.hook_event_name);
      if (eventName === undefined) throw new Error(`unknown hook event ${String(body.hook_event_name)}`);
      const fixture = readHookFixture(eventName);
      expect(body).toEqual({ ...fixture, session_id: SESSION_ID, cwd: process.cwd(), ...(eventName === "UserPromptSubmit" ? { prompt: PROMPT } : {}) });
    }
  });

  it("prints the scripted conversation to the terminal", async () => {
    const { url } = await startBridge("allow");

    const { output } = await runTurn(url);

    expect(output).toContain(PROMPT);
    expect(output).toContain("mcp__studio__render_master");
    expect(output).toContain("The render is queued.");
  });

  it("skips PostToolUse and prints the reason when the bridge denies the tool", async () => {
    const { url, received } = await startBridge("deny");

    const { output, exitCode } = await runTurn(url);

    expect(exitCode).toBe(0);
    expect(received.map(({ body }) => body.hook_event_name)).not.toContain("PostToolUse");
    expect(output).toContain("Rendering is paused.");
  });
});
