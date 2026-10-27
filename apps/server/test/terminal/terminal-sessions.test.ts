// Created by The Angelo Umali.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PASTE_END, PASTE_START } from "../../src/terminal/prompt-input.ts";
import type { PtyHost, TerminalPty } from "../../src/terminal/pty-host.ts";
import type { TerminalSession } from "../../src/terminal/terminal-sessions.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, stubReport, waitFor } from "./stub-claude.ts";
import { CATALOG_TOOL, createTerminalFixture, PROJECT_ID, type TerminalFixture } from "./terminal-fixture.ts";

const RESUMED_SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";

let fixture: TerminalFixture;

afterEach(async () => {
  await fixture.cleanup();
});

async function openSession(overrides: { resumeSessionId?: string } = {}): Promise<TerminalSession> {
  return fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "rules", ...overrides });
}

/** Exits the moment it is killed, so a reopen lands while the old session's files are still being removed. */
function instantExitPtyHost(): PtyHost {
  const ptys = new Map<string, TerminalPty>();
  return {
    claudePath: process.execPath,
    launch(sessionId) {
      const exitListeners: ((exitCode: number) => void)[] = [];
      const pty: TerminalPty = {
        sessionId,
        write: () => undefined,
        resize: () => undefined,
        interrupt: () => undefined,
        kill: () => exitListeners.forEach((listener) => listener(0)),
        snapshot: () => "",
        onData: () => () => undefined,
        onExit: (listener) => {
          exitListeners.push(listener);
          return () => undefined;
        },
      };
      ptys.set(sessionId, pty);
      return Promise.resolve(pty);
    },
    get: (sessionId) => ptys.get(sessionId),
  };
}

function hook(sessionId: string, fields: Record<string, unknown>) {
  return { session_id: sessionId, ...fields } as Parameters<TerminalFixture["sessions"]["handleHook"]>[1];
}

async function startSession(session: TerminalSession): Promise<void> {
  await fixture.sessions.handleHook(session.sessionId, hook(session.sessionId, { hook_event_name: "SessionStart", permission_mode: "default" }));
}

describe("terminal sessions", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("launches claude in the project folder with the §6.3 flags and announces it is starting", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession();
    await waitFor(() => session.pty.snapshot().includes("READY"));

    const report = stubReport(session);
    expect(report.argv.slice(0, 2)).toEqual(["--session-id", session.sessionId]);
    expect(report.argv).toContain("--restricted");
    expect(report.envKeys).toEqual(expect.arrayContaining(["ZKS_HOOK_TOKEN", "ZKS_MCP_TOKEN", "ZKS_MCP_URL"]));
    expect(report.cwd).toBe(fixture.projectDir);
    expect(fixture.events).toContainEqual({ type: "terminal.state", projectId: PROJECT_ID, state: "starting" });
    expect(fixture.sessions.findByProject(PROJECT_ID)).toBe(session);
  });

  it("reopens a project session with --resume", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession({ resumeSessionId: RESUMED_SESSION_ID });
    await waitFor(() => session.pty.snapshot().includes("READY"));
    expect(stubReport(session).argv.slice(0, 2)).toEqual(["--resume", RESUMED_SESSION_ID]);
  });

  it("resumes the same session right after a kill, before the old session's files are gone", async () => {
    fixture = await createTerminalFixture();
    const first = await openSession({ resumeSessionId: RESUMED_SESSION_ID });
    await waitFor(() => first.pty.snapshot().includes("READY"));
    fixture.sessions.kill(PROJECT_ID);
    while (fixture.sessions.findByProject(PROJECT_ID) !== undefined) await new Promise(setImmediate);

    const reopened = await openSession({ resumeSessionId: RESUMED_SESSION_ID });
    await waitFor(() => reopened.pty.snapshot().includes("READY"));
    expect(stubReport(reopened).argv.slice(0, 2)).toEqual(["--resume", RESUMED_SESSION_ID]);
  });

  it("reports claude_missing when the resolved binary is gone", async () => {
    fixture = await createTerminalFixture({}, { isClaudeMissing: true });

    await expect(openSession()).rejects.toMatchObject({ reason: "claude_missing" });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.error", kind: "claude_missing" }));
  });

  it("authenticates hooks with the session's own token only", async () => {
    fixture = await createTerminalFixture();
    const first = await openSession();
    expect(fixture.sessions.isHookAuthorized(first.sessionId, first.hookToken)).toBe(true);
    expect(fixture.sessions.isHookAuthorized(first.sessionId, "forged")).toBe(false);
    expect(fixture.sessions.isHookAuthorized(first.sessionId, undefined)).toBe(false);
    expect(fixture.sessions.isHookAuthorized(RESUMED_SESSION_ID, first.hookToken)).toBe(false);
  });

  it("denies Bash, allows a project Read, and reports catalog tools in the feed", async () => {
    fixture = await createTerminalFixture();
    const { sessionId } = await openSession();
    const preToolUse = (toolName: string, toolInput: unknown) =>
      fixture.sessions.handleHook(
        sessionId,
        hook(sessionId, { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "toolu_1" }),
      );

    expect(await preToolUse("Bash", { command: "id" })).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "tool.denied", name: "Bash" }));

    expect(await preToolUse("Read", { file_path: join(fixture.projectDir, "cuts.json") })).toMatchObject({
      hookSpecificOutput: { permissionDecision: "allow" },
    });
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "tool.called", name: "Read", toolUseId: "toolu_1" }));

    const eventCount = fixture.events.length;
    expect(await preToolUse(CATALOG_TOOL, {})).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
    expect(fixture.events.slice(eventCount)).toEqual([expect.objectContaining({ type: "tool.called", name: CATALOG_TOOL })]);
  });

  // Spike 07 proved Claude Code blocks only when the bridge is unreachable, so an error must never reach the hook as a 500.
  it("still answers PreToolUse with its decision when publishing the event fails", async () => {
    const publish = (event: { type: string }) => (event.type.startsWith("tool.") ? Promise.reject(new Error("event bus down")) : Promise.resolve());
    fixture = await createTerminalFixture({ eventBus: { publish } });
    const { sessionId } = await openSession();
    const answer = (toolName: string, toolInput: unknown) =>
      fixture.sessions.handleHook(
        sessionId,
        hook(sessionId, { hook_event_name: "PreToolUse", tool_name: toolName, tool_input: toolInput, tool_use_id: "toolu_1" }),
      );

    expect(await answer("Bash", { command: "id" })).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
    expect(await answer("Read", { file_path: join(fixture.projectDir, "cuts.json") })).toMatchObject({ hookSpecificOutput: { permissionDecision: "allow" } });
  });

  it("denies a tool when the policy itself throws", async () => {
    const brokenCatalog = Object.assign([CATALOG_TOOL], {
      includes: () => {
        throw new Error("policy broke");
      },
    });
    fixture = await createTerminalFixture({ studioToolNames: brokenCatalog });
    const { sessionId } = await openSession();

    const answer = await fixture.sessions.handleHook(
      sessionId,
      hook(sessionId, { hook_event_name: "PreToolUse", tool_name: CATALOG_TOOL, tool_input: {}, tool_use_id: "toolu_1" }),
    );

    expect(answer).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
  });

  it("denies a PreToolUse whose session has already ended instead of failing the hook", async () => {
    fixture = await createTerminalFixture();
    const endedSessionId = "0b7e7f8e-3a51-4c8e-9d0f-5f1d2c3b4a59";

    const toolAnswer = await fixture.sessions.handleHook(
      endedSessionId,
      hook(endedSessionId, { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_use_id: "toolu_1" }),
    );
    const stopAnswer = await fixture.sessions.handleHook(endedSessionId, hook(endedSessionId, { hook_event_name: "Stop" }));

    expect(toolAnswer).toMatchObject({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" } });
    expect(stopAnswer).toEqual({});
  });

  it("marks the session ready on SessionStart and only then admits MCP calls", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession();
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(false);

    expect(
      await fixture.sessions.handleHook(session.sessionId, hook(session.sessionId, { hook_event_name: "SessionStart", permission_mode: "default" })),
    ).toEqual({});
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.started", credential: "your Claude Code sign-in", model: "haiku" }));
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, "forged")).toBe(false);
  });

  it("kills the terminal when SessionStart reports a permission mode other than default", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession();
    await fixture.sessions.handleHook(session.sessionId, hook(session.sessionId, { hook_event_name: "SessionStart", permission_mode: "bypassPermissions" }));
    await waitFor(() => fixture.events.some((event) => event.type === "terminal.state" && event.state === "exited"));
    expect(fixture.sessions.find(session.sessionId)).toBeUndefined();
  });

  it("hands the pane to the user, without killing it, when SessionStart never arrives", async () => {
    fixture = await createTerminalFixture({ sessionStartTimeoutMs: 50 });
    const session = await openSession();
    await waitFor(() => fixture.events.some((event) => event.type === "terminal.state" && event.state === "waiting"));
    expect(fixture.sessions.find(session.sessionId)).toBe(session);
  });

  it("holds prompts sent before SessionStart, while the trust dialog may own the pane, and sends them in order after it", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession();
    await waitFor(() => session.pty.snapshot().includes("READY"));

    expect(fixture.sessions.submitPrompt(PROJECT_ID, "first cut")).toBe(true);
    expect(fixture.sessions.submitPrompt(PROJECT_ID, "second cut")).toBe(true);
    // PTY input is ordered, so a prompt written before this marker would echo before it.
    session.pty.write("MARKER");
    await waitFor(() => session.pty.snapshot().includes("MARKER"));
    expect(session.pty.snapshot()).not.toContain("first cut");

    await startSession(session);
    await waitFor(() => session.pty.snapshot().includes("second cut"));
    const output = session.pty.snapshot();
    expect(output.indexOf("first cut")).toBeGreaterThan(output.indexOf("MARKER"));
    expect(output.indexOf("second cut")).toBeGreaterThan(output.indexOf("first cut"));
  });

  it("drops a held prompt with its session, so a declined trust prompt never replays into the next terminal", async () => {
    fixture = await createTerminalFixture();
    const declined = await openSession();
    await waitFor(() => declined.pty.snapshot().includes("READY"));
    expect(fixture.sessions.submitPrompt(PROJECT_ID, "never sent")).toBe(true);
    declined.pty.write("EXIT 0");
    await waitFor(() => fixture.sessions.find(declined.sessionId) === undefined);

    const next = await openSession();
    await waitFor(() => next.pty.snapshot().includes("READY"));
    await startSession(next);
    next.pty.write("MARKER");
    await waitFor(() => next.pty.snapshot().includes("MARKER"));
    expect(declined.pty.snapshot() + next.pty.snapshot()).not.toContain("never sent");
  });

  it("submits a prompt as a bracketed paste, stops with Esc, and cleans up on Kill", async () => {
    fixture = await createTerminalFixture();
    const session = await openSession();
    await waitFor(() => session.pty.snapshot().includes("READY"));
    await startSession(session);

    expect(fixture.sessions.submitPrompt(PROJECT_ID, "trim\x1b[201~")).toBe(true);
    await waitFor(() => session.pty.snapshot().includes("GOT"));
    expect(session.pty.snapshot()).toContain(JSON.stringify(`${PASTE_START}trim[201~${PASTE_END}\r`).slice(1, -1));

    expect(fixture.sessions.stop(PROJECT_ID)).toBe(true);
    await waitFor(() => session.pty.snapshot().includes("INTERRUPTED"));
    // Claude Code fires no Stop hook on an interrupt, so the server reports the turn over itself.
    await waitFor(() => {
      const latest = fixture.events.at(-1);
      return latest?.type === "terminal.state" && latest.state === "ready";
    });

    // An early interrupt puts the prompt back in Claude Code's input, so the next one erases it first.
    expect(fixture.sessions.submitPrompt(PROJECT_ID, "next")).toBe(true);
    await waitFor(() => session.pty.snapshot().includes("next"));
    expect(session.pty.snapshot()).toContain(JSON.stringify(`${"\x7f".repeat("trim[201~".length)}${PASTE_START}next`).slice(1, -1));
    expect(fixture.sessions.submitPrompt(PROJECT_ID, "after")).toBe(true);
    await waitFor(() => session.pty.snapshot().includes("after"));
    // Only the prompt an interrupt put back is erased.
    expect(session.pty.snapshot()).toContain(`GOT ${JSON.stringify(`${PASTE_START}after`).slice(0, -1)}`);

    const sessionDir = join(fixture.runDir, session.sessionId);
    expect(fixture.sessions.kill(PROJECT_ID)).toBe(true);
    await waitFor(() => fixture.events.some((event) => event.type === "terminal.state" && event.state === "exited"));
    await waitFor(() => fixture.sessions.find(session.sessionId) === undefined);
    await expect(stat(sessionDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(fixture.events).not.toContainEqual(expect.objectContaining({ type: "session.error" }));
    expect(fixture.sessions.submitPrompt(PROJECT_ID, "again")).toBe(false);
    expect(fixture.cancelledProjects).toEqual([PROJECT_ID]);
  });

  it("cancels the project's jobs when claude exits unexpectedly, and leaves them on a clean exit", async () => {
    fixture = await createTerminalFixture();
    const crashed = await openSession();
    await waitFor(() => crashed.pty.snapshot().includes("READY"));
    crashed.pty.write("EXIT 3");
    await waitFor(() => fixture.sessions.find(crashed.sessionId) === undefined);
    expect(fixture.cancelledProjects).toEqual([PROJECT_ID]);
    // Exit events publish only after the session files are removed, which lags the map delete on a slow disk.
    await waitFor(() => fixture.events.some((event) => event.type === "session.error" && event.kind === "terminal_exited"));

    const finished = await openSession();
    await waitFor(() => finished.pty.snapshot().includes("READY"));
    finished.pty.write("EXIT 0");
    await waitFor(() => fixture.sessions.find(finished.sessionId) === undefined);
    expect(fixture.cancelledProjects).toEqual([PROJECT_ID]);
  });

  it("keeps a resumed session's files when the killed session's cleanup finishes after the reopen", async () => {
    fixture = await createTerminalFixture({ ptyHost: instantExitPtyHost() });
    const first = await openSession({ resumeSessionId: RESUMED_SESSION_ID });

    expect(fixture.sessions.kill(PROJECT_ID)).toBe(true);
    const reopened = await openSession({ resumeSessionId: first.sessionId });
    await waitFor(() => fixture.events.some((event) => event.type === "terminal.state" && event.state === "exited"));

    expect(reopened.sessionId).toBe(first.sessionId);
    // Each launch writes its own <sessionId>.<uuid> folder; only the reopened one's may remain.
    const sessionFolders = (await readdir(fixture.runDir)).filter((name) => name.startsWith(`${reopened.sessionId}.`));
    expect(sessionFolders).toHaveLength(1);
    await Promise.all(sessionFolders.map((folder) => expect(stat(join(fixture.runDir, folder, "settings.json"))).resolves.toBeDefined()));
  });
});
