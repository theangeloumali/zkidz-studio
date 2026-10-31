// Created by The Angelo Umali.
// Codex and OpenCode sessions through the adapter seam (ADR 0007), with fake adapters over the stub binary.
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HookPayload } from "@zks/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentAdapter } from "../../src/terminal/agents/agent-adapter.ts";
import { createPtyHost, type PtyHost, type TerminalPty } from "../../src/terminal/pty-host.ts";
import { encodePrompt } from "../../src/terminal/prompt-input.ts";
import type { TerminalSession } from "../../src/terminal/terminal-sessions.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, waitFor, writeStubClaude } from "./stub-claude.ts";
import { createTerminalFixture, PROJECT_ID, type TerminalFixture } from "./terminal-fixture.ts";

const AGENT_SESSION_ID = "codex-thread-1";
let fixture: TerminalFixture;
let stubDir: string;

afterEach(async () => {
  await fixture.cleanup();
  await rm(stubDir, { recursive: true, force: true });
});

function baseAdapter(kind: "codex" | "opencode"): Omit<AgentAdapter, "events"> {
  return {
    kind,
    binaryNames: [kind],
    versionArgs: ["--version"],
    minVersion: "0.0.0",
    async prepare(request, _tokens, binaryPath) {
      const filesDir = join(request.runDir, `${request.sessionId}.agent`);
      await mkdir(filesDir, { recursive: true });
      return { file: binaryPath, args: [], env: { PATH: process.env.PATH ?? "" }, cwd: request.projectDir, filesDir };
    },
  };
}

async function openAgent(kind: "codex" | "opencode", adapter: AgentAdapter): Promise<TerminalSession> {
  stubDir = await mkdtemp(join(tmpdir(), "zks-agent-stub-"));
  const binaryPath = await writeStubClaude(stubDir);
  fixture = await createTerminalFixture({ ptyHost: createPtyHost({ claudePath: binaryPath }), agents: new Map([[kind, { adapter, binaryPath }]]) });
  return fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "rules", agentKind: kind });
}

/** A PTY the test feeds by hand: `print` sends a chunk, and `written` is everything the studio typed. */
function scriptedPtyHost(initialScreen: string) {
  const dataListeners: ((output: string) => void)[] = [];
  let screen = initialScreen;
  let written = "";
  const pty: TerminalPty = {
    sessionId: "",
    write: (data) => void (written += data),
    resize: () => undefined,
    interrupt: () => undefined,
    kill: () => undefined,
    snapshot: () => screen,
    onData: (listener) => {
      dataListeners.push(listener);
      return () => void dataListeners.splice(dataListeners.indexOf(listener), 1);
    },
    onExit: () => () => undefined,
  };
  const host: PtyHost = { claudePath: process.execPath, launch: () => Promise.resolve(pty), get: () => pty };
  const print = (output: string) => {
    screen += output;
    for (const listener of [...dataListeners]) listener(output);
  };
  return { host, print, written: () => written };
}

async function openScripted(initialScreen: string) {
  const scripted = scriptedPtyHost(initialScreen);
  const adapter: AgentAdapter = { ...baseAdapter("codex"), inputReady: /\? for shortcuts/, events: { kind: "hooks", mapHook: () => [] } };
  stubDir = await mkdtemp(join(tmpdir(), "zks-agent-stub-"));
  fixture = await createTerminalFixture({ ptyHost: scripted.host, agents: new Map([["codex", { adapter, binaryPath: process.execPath }]]), inputSettleMs: 0 });
  await fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "rules", agentKind: "codex" });
  return scripted;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function hook(sessionId: string, fields: Record<string, unknown>) {
  return { session_id: sessionId, ...fields } as HookPayload;
}

describe("terminal sessions for Codex and OpenCode", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("runs a hook-driven agent through the studio's policy, readiness and usage", async () => {
    const adapter: AgentAdapter = {
      ...baseAdapter("codex"),
      events: { kind: "hooks", mapHook: (payload) => [{ type: "narration", projectId: PROJECT_ID, text: (payload as HookPayload).hook_event_name }] },
      usageSource: (agentSessionId) => Promise.resolve(agentSessionId === AGENT_SESSION_ID ? { inputTokens: 40, outputTokens: 2 } : null),
    };
    const session = await openAgent("codex", adapter);
    const { sessionId } = session;
    await waitFor(() => session.pty.snapshot().includes("READY"));
    expect(fixture.sessions.isMcpCallAllowed(sessionId, session.mcpToken)).toBe(false);

    await fixture.sessions.handleHook(sessionId, hook(AGENT_SESSION_ID, { hook_event_name: "SessionStart" }));
    expect(fixture.sessions.isMcpCallAllowed(sessionId, session.mcpToken)).toBe(true);
    expect(
      await fixture.sessions.handleHook(sessionId, hook(AGENT_SESSION_ID, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "id" } })),
    ).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    await fixture.sessions.handleHook(sessionId, hook(AGENT_SESSION_ID, { hook_event_name: "Stop", last_assistant_message: "done" }));

    await waitFor(() => fixture.events.some((event) => event.type === "usage.reported"));
    expect(fixture.events).toContainEqual({ type: "usage.reported", projectId: PROJECT_ID, sessionId, source: "codex", inputTokens: 40, outputTokens: 2 });
    expect(fixture.events.filter((event) => event.type === "narration").map((event) => event.type === "narration" && event.text)).toEqual([
      "SessionStart",
      "PreToolUse",
      "Stop",
    ]);
  });

  it("sends a Prompt-box prompt once the agent's input is drawn, for an agent whose SessionStart only comes with the first prompt", async () => {
    const adapter: AgentAdapter = { ...baseAdapter("codex"), inputReady: /READY/, events: { kind: "hooks", mapHook: () => [] } };
    const session = await openAgent("codex", adapter);

    expect(fixture.sessions.submitPrompt(PROJECT_ID, "cut it")).toBe(true);

    await waitFor(() => session.pty.snapshot().includes("cut it"));
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);
  });

  it("holds a Prompt-box prompt through the banner and sends it once the composer's hint arrives, even split across chunks", async () => {
    const scripted = await openScripted("");
    fixture.sessions.submitPrompt(PROJECT_ID, "cut it");
    scripted.print("   >_ OpenAI Codex (v0.165.0)     loading");
    scripted.print("  › Ask Codex to do anything    ? for sh");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(scripted.written()).not.toContain("cut it");

    scripted.print("ortcuts");

    await waitFor(() => scripted.written().includes("cut it"));
  });

  it("sends a Prompt-box prompt at once when the composer was already drawn before the watch began", async () => {
    const scripted = await openScripted("› Ask Codex to do anything    ? for shortcuts");
    fixture.sessions.submitPrompt(PROJECT_ID, "cut it");

    await waitFor(() => scripted.written().includes("cut it"));
  });

  it("names the agent that crashed, not Claude Code, when a Codex session exits on its own", async () => {
    const session = await openAgent("codex", { ...baseAdapter("codex"), events: { kind: "hooks", mapHook: () => [] } });
    await waitFor(() => session.pty.snapshot().includes("READY"));

    session.pty.write("EXIT 3\r");

    await waitFor(() => fixture.events.some((event) => event.type === "session.error"));
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.error", kind: "terminal_exited", message: "Codex exited with code 3." }));
  });

  it("starts a stream-driven agent's companion first, publishes its stream, and stops both with Kill", async () => {
    let unsubscribed = false;
    const pidFile = join(tmpdir(), `zks-companion-${process.pid}-${Date.now()}.pid`);
    const adapter: AgentAdapter = {
      ...baseAdapter("opencode"),
      async prepare(request, tokens, binaryPath) {
        const launch = await baseAdapter("opencode").prepare(request, tokens, binaryPath);
        const script = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => undefined, 1000);`;
        // The real adapter reads its server's address off this stdout; the fake only waits for the child to be up.
        const connect = async () => {
          await waitFor(() => existsSync(pidFile));
          return launch;
        };
        return { ...launch, companion: { file: process.execPath, args: ["-e", script], env: { PATH: process.env.PATH ?? "" }, connect } };
      },
      events: {
        kind: "stream",
        subscribe(_launch, context, publish) {
          publish([{ type: "narration", projectId: context.projectId, text: "from the stream" }]);
          return () => (unsubscribed = true);
        },
      },
    };
    const session = await openAgent("opencode", adapter);
    await waitFor(() => session.pty.snapshot().includes("READY"));
    const companionPid = Number(await readFile(pidFile, "utf8"));
    expect(isRunning(companionPid)).toBe(true);

    // No SessionStart hook ever comes: the companion answering is the start.
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);
    expect(fixture.events).toContainEqual({ type: "narration", projectId: PROJECT_ID, text: "from the stream" });

    // Nothing can confirm the prompt landed, so it is written once and never resent.
    fixture.sessions.submitPrompt(PROJECT_ID, "cut it");
    await waitFor(() => session.pty.snapshot().includes("cut it"));
    expect(session.pty.snapshot().split(encodePrompt("cut it")).length).toBeLessThanOrEqual(2);

    fixture.sessions.kill(PROJECT_ID);
    await waitFor(() => fixture.sessions.findByProject(PROJECT_ID) === undefined);
    expect(unsubscribed).toBe(true);
    await waitFor(() => !isRunning(companionPid));
    await rm(pidFile, { force: true });
  });

  it("closes the session and says why when the companion dies after it started", async () => {
    const pidFile = join(tmpdir(), `zks-companion-late-${process.pid}-${Date.now()}.pid`);
    const adapter: AgentAdapter = {
      ...baseAdapter("opencode"),
      async prepare(request, tokens, binaryPath) {
        const launch = await baseAdapter("opencode").prepare(request, tokens, binaryPath);
        const script = `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => undefined, 1000);`;
        const connect = async () => {
          await waitFor(() => existsSync(pidFile));
          return launch;
        };
        return { ...launch, companion: { file: process.execPath, args: ["-e", script], env: { PATH: process.env.PATH ?? "" }, connect } };
      },
      events: { kind: "stream", subscribe: () => () => undefined },
    };
    const session = await openAgent("opencode", adapter);
    await waitFor(() => session.pty.snapshot().includes("READY"));
    process.kill(Number(await readFile(pidFile, "utf8")), "SIGKILL");

    await waitFor(() => fixture.sessions.findByProject(PROJECT_ID) === undefined);
    const stopped = fixture.events.find((event) => event.type === "session.error");
    expect(stopped).toMatchObject({ kind: "terminal_exited" });
    expect(stopped?.type === "session.error" ? stopped.message : "").toMatch(/server stopped/);
    await rm(pidFile, { force: true });
  });

  it("fails the open at once when the companion dies before it answers", async () => {
    const adapter: AgentAdapter = {
      ...baseAdapter("opencode"),
      async prepare(request, tokens, binaryPath) {
        const launch = await baseAdapter("opencode").prepare(request, tokens, binaryPath);
        const connect = (_output: AsyncIterable<Uint8Array | string>, signal: AbortSignal) =>
          new Promise<never>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
        return { ...launch, companion: { file: process.execPath, args: ["-e", "process.exit(3)"], env: { PATH: process.env.PATH ?? "" }, connect } };
      },
      events: { kind: "stream", subscribe: () => () => undefined },
    };
    const startedAt = Date.now();
    await expect(openAgent("opencode", adapter)).rejects.toThrow(/exited \(code 3\)/);
    expect(Date.now() - startedAt).toBeLessThan(10_000);
    expect(fixture.sessions.findByProject(PROJECT_ID)).toBeUndefined();
    // The session's files hold its config; a failed launch leaves none behind.
    expect(await readdir(fixture.runDir)).toEqual([]);
  });

  it("reports a missing agent instead of starting claude in its place", async () => {
    stubDir = await mkdtemp(join(tmpdir(), "zks-agent-stub-"));
    fixture = await createTerminalFixture();
    const opening = fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, rulesText: "rules", agentKind: "codex" });

    await expect(opening).rejects.toMatchObject({ reason: "agent_missing" });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.error", kind: "agent_missing" }));
  });
});
