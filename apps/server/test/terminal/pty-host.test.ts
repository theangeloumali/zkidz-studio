// Created by The Angelo Umali.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildAgentEnv } from "../../src/auth/agent-env.ts";
import { createPtyHost, TerminalLaunchError, type PtyHost, type TerminalPty } from "../../src/terminal/pty-host.ts";
import { INTERRUPT_KEY } from "../../src/terminal/prompt-input.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, waitFor, writeStubClaude } from "./stub-claude.ts";

const SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";
const OTHER_SESSION_ID = "9d0c4b1e-2f3a-4b5c-8d7e-6f5a4b3c2d1e";

let scratchDir: string;
let claudePath: string;
let host: PtyHost;
const openPtys: TerminalPty[] = [];

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-pty-"));
  claudePath = await writeStubClaude(scratchDir);
});

afterEach(() => {
  for (const pty of openPtys.splice(0)) pty.kill();
});

afterAll(async () => {
  await rm(scratchDir, { recursive: true, force: true });
});

function launchStub(sessionId = SESSION_ID, extraArgs: string[] = []): TerminalPty {
  const tokens = { hookToken: "hook-token", mcpToken: "mcp-token", mcpUrl: "http://127.0.0.1:9/api/mcp/s1" };
  const env = buildAgentEnv({ kind: "terminal", tokens }, { studioHome: scratchDir, appVersion: "0.0.0-test", proxyOptIn: false });
  const pty = host.launch(sessionId, { argv: [claudePath, "--session-id", sessionId, ...extraArgs], cwd: scratchDir, env });
  openPtys.push(pty);
  return pty;
}

describe("createPtyHost", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("requires an absolute claude path", () => {
    expect(() => createPtyHost({ claudePath: "claude" })).toThrow(/absolute/);
  });

  it("spawns nothing but the resolved claude binary", () => {
    host = createPtyHost({ claudePath: "/usr/local/bin/claude" });
    expect(() => host.launch(SESSION_ID, { argv: ["/bin/sh", "-c", "id"], cwd: scratchDir, env: {} })).toThrow(
      expect.objectContaining({ reason: "wrong_binary" }) as Error,
    );
  });

  it("refuses an env carrying a credential, naming the variable but never its value", () => {
    host = createPtyHost({ claudePath: "/usr/local/bin/claude" });
    const launchWithKey = () => host.launch(SESSION_ID, { argv: ["/usr/local/bin/claude"], cwd: scratchDir, env: { ANTHROPIC_API_KEY: "sk-secret" } });
    expect(launchWithKey).toThrow(TerminalLaunchError);
    expect(launchWithKey).toThrow(/ANTHROPIC_API_KEY/);
    expect(launchWithKey).not.toThrow(/sk-secret/);
  });
});

describe("a launched terminal", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("runs claude with the given argv, cwd and only the given env", async () => {
    host = createPtyHost({ claudePath, maxSessions: 2 });
    const pty = launchStub();
    let output = "";
    pty.onData((chunk) => (output += chunk));
    await waitFor(() => output.includes("READY"));

    const report = JSON.parse(/READY (\{.*\})/.exec(output)?.[1] ?? "{}") as { argv: string[]; cwd: string; envKeys: string[] };
    expect(report.argv).toEqual(["--session-id", SESSION_ID]);
    expect(report.envKeys).toContain("ZKS_HOOK_TOKEN");
    expect(report.envKeys.filter((key) => key.startsWith("ANTHROPIC_"))).toEqual([]);
    expect(host.get(SESSION_ID)).toBe(pty);
  });

  it("forwards input, sends Esc as the interrupt and keeps output for a reconnect", async () => {
    host = createPtyHost({ claudePath });
    const pty = launchStub();
    await waitFor(() => pty.snapshot().includes("READY"));

    pty.write("hi");
    pty.interrupt();
    await waitFor(() => pty.snapshot().includes("INTERRUPTED"));
    expect(pty.snapshot()).toContain('GOT "hi"');
    expect(INTERRUPT_KEY).toBe("\x1b");
  });

  it("caps live terminals and frees the slot when one is killed", async () => {
    host = createPtyHost({ claudePath, maxSessions: 1 });
    const first = launchStub();
    expect(() => launchStub(OTHER_SESSION_ID)).toThrow(expect.objectContaining({ reason: "session_cap" }) as Error);

    let exitCode: number | undefined;
    first.onExit((code) => (exitCode = code));
    first.kill();
    await waitFor(() => exitCode !== undefined);
    expect(host.get(SESSION_ID)).toBeUndefined();
    expect(launchStub(OTHER_SESSION_ID).sessionId).toBe(OTHER_SESSION_ID);
  });

  it("refuses a second terminal for the same session", () => {
    host = createPtyHost({ claudePath, maxSessions: 2 });
    launchStub();
    expect(() => launchStub()).toThrow(expect.objectContaining({ reason: "duplicate_session" }) as Error);
  });
});
