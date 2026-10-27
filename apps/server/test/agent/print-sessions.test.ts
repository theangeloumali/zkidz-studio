// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { API_ROUTES, type HookPayload } from "@zks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptInbox } from "../../src/agent/inbox.ts";
import { createPrintSessions, type PrintSessions } from "../../src/agent/print-sessions.ts";
import type { SpawnClaude } from "../../src/agent/print-runner.ts";
import { createSessionToken, tokensMatch } from "../../src/security/token.ts";

const FAKE_CLAUDE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const APP_PORT = 4317;
const PENDING_STOP_WAIT_MS = 3000;

interface FakeInit {
  readonly argv: readonly string[];
  readonly studioEnv: { readonly mcpUrl: string; readonly mcpToken: string; readonly hookToken: string };
}

describe("createPrintSessions", () => {
  let scratchDir = "";
  let spawnCount = 0;
  let sessions: PrintSessions;
  const runFake: SpawnClaude = (command, args, options) => {
    spawnCount += 1;
    return spawn(process.execPath, [FAKE_CLAUDE, ...args], options);
  };
  const projectDir = () => join(scratchDir, "project");
  const pluginDir = () => join(scratchDir, "plugin");

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-print-"));
    spawnCount = 0;
    await mkdir(projectDir());
    await mkdir(pluginDir());
    await writeFile(join(projectDir(), "notes.txt"), "ok");
    sessions = createPrintSessions({
      claudePath: "claude",
      runDir: join(scratchDir, "run"),
      appPort: APP_PORT,
      pluginDir: pluginDir(),
      createToken: createSessionToken,
      tokensMatch,
      spawn: runFake,
    });
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  function start(abortController = new AbortController()) {
    const handle = sessions.query({
      prompt: new PromptInbox(),
      projectId: "project-1",
      options: { maxTurns: 3, cwd: projectDir(), env: { PATH: process.env.PATH ?? "" }, abortController },
    });
    const iterator: AsyncIterator<SDKMessage, unknown> = handle[Symbol.asyncIterator]();
    const firstInit = async () => {
      const { value } = await iterator.next();
      if (typeof value !== "object" || value === null || !("studioEnv" in value)) throw new Error("the fake did not report its env");
      return value as unknown as FakeInit;
    };
    return { handle, iterator, firstInit };
  }

  const sessionIdOf = (init: FakeInit) => decodeURIComponent(init.studioEnv.mcpUrl.split("/").at(-1) ?? "");
  const flagValue = (init: FakeInit, flag: string) => init.argv[init.argv.indexOf(flag) + 1] ?? "";
  const preToolUse = (sessionId: string, toolName: string, toolInput: unknown): HookPayload => ({
    session_id: sessionId,
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: toolInput,
    tool_use_id: "toolu_1",
  });

  it("registers the run for the MCP twin with its own tokens while claude -p runs", async () => {
    const { handle, firstInit } = start();
    const init = await firstInit();
    const sessionId = sessionIdOf(init);

    expect(init.studioEnv.mcpUrl).toBe(`http://127.0.0.1:${APP_PORT}/api/mcp/${sessionId}`);
    expect(sessions.find(sessionId)).toEqual({ projectId: "project-1", mcpToken: init.studioEnv.mcpToken });
    expect(sessions.isHookAuthorized(sessionId, init.studioEnv.hookToken)).toBe(true);
    expect(sessions.isHookAuthorized(sessionId, init.studioEnv.mcpToken)).toBe(false);
    expect(sessions.find("not-a-session")).toBeUndefined();
    handle.close?.();
  });

  it("writes an MCP config for the stdio twin and a settings file whose only hook confines Read", async () => {
    const { handle, firstInit } = start();
    const init = await firstInit();
    const sessionId = sessionIdOf(init);
    const mcpConfig: unknown = JSON.parse(await readFile(flagValue(init, "--mcp-config"), "utf8"));
    const settings: unknown = JSON.parse(await readFile(flagValue(init, "--settings"), "utf8"));

    expect(mcpConfig).toMatchObject({ mcpServers: { studio: { type: "stdio", env: { ZKS_MCP_TOKEN: "${ZKS_MCP_TOKEN}", ZKS_MCP_URL: "${ZKS_MCP_URL}" } } } });
    expect(settings).toEqual({
      hooks: {
        PreToolUse: [
          {
            matcher: "Read",
            hooks: [
              {
                type: "http",
                url: `http://127.0.0.1:${APP_PORT}${API_ROUTES.terminalHooks.path.replace(":sessionId", sessionId)}`,
                headers: { Authorization: "Bearer $ZKS_HOOK_TOKEN" },
                allowedEnvVars: ["ZKS_HOOK_TOKEN"],
                timeout: 30,
                onFailure: "block",
              },
            ],
          },
        ],
      },
    });
    handle.close?.();
  });

  // A hook "allow" would skip the approve permission-prompt tool, so the answer is deny or nothing.
  it("denies reads outside the project and plugin folders and answers nothing else", async () => {
    const { handle, firstInit } = start();
    const sessionId = sessionIdOf(await firstInit());
    await writeFile(join(scratchDir, "secret.txt"), "no");

    expect(await sessions.handleHook(sessionId, preToolUse(sessionId, "Read", { file_path: join(projectDir(), "notes.txt") }))).toEqual({});
    expect(await sessions.handleHook(sessionId, preToolUse(sessionId, "Read", { file_path: join(scratchDir, "secret.txt") }))).toMatchObject({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny" },
    });
    expect(await sessions.handleHook(sessionId, preToolUse(sessionId, "mcp__studio__list_media", {}))).toEqual({});
    handle.close?.();
  });

  it("forgets the session and removes its files when the run ends", async () => {
    const { handle, iterator, firstInit } = start();
    const init = await firstInit();
    const sessionId = sessionIdOf(init);
    handle.close?.();
    while (!(await iterator.next()).done);

    expect(sessions.find(sessionId)).toBeUndefined();
    expect(sessions.isHookAuthorized(sessionId, init.studioEnv.hookToken)).toBe(false);
    expect(existsSync(dirname(flagValue(init, "--settings")))).toBe(false);
  });

  it("applies a Stop that arrives before the child is spawned once it starts", async () => {
    const { handle, iterator } = start();
    await handle.interrupt?.();

    const drain = async () => {
      try {
        while (!(await iterator.next()).done);
      } catch {
        // A child stopped before it set up its own SIGINT handler exits on the signal.
      }
      return "stopped";
    };
    const stillRunning = new Promise<string>((resolve) => setTimeout(() => resolve("still running"), PENDING_STOP_WAIT_MS));

    expect(await Promise.race([drain(), stillRunning])).toBe("stopped");
    expect(spawnCount).toBe(1);
    handle.close?.();
  });

  it("never spawns claude for a session aborted before it started", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const { iterator } = start(abortController);
    expect((await iterator.next()).done).toBe(true);
    expect(spawnCount).toBe(0);
  });
});
