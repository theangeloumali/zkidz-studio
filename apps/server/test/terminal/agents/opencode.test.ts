// Created by The Angelo Umali.
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NewStudioEvent } from "../../../src/events/event-bus.ts";
import type { PreparedLaunch } from "../../../src/terminal/agents/agent-adapter.ts";
import { createOpenCodeAdapter, OPENCODE_PERMISSIONS } from "../../../src/terminal/agents/opencode.ts";
import { MCP_SERVER_PATH } from "../../../src/terminal/session-files.ts";
import { waitFor } from "../stub-claude.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
const TOKENS = { hookToken: "hook-secret", mcpToken: "mcp-secret", mcpUrl: "http://127.0.0.1:4100/mcp/x" };
const PARENT_ENV = { PATH: "/usr/bin", HOME: "/home/user", XDG_DATA_HOME: "/home/user/.local/share", GEMINI_API_KEY: "parent" };
const PORT = 47123;
const SERVER_URL = `http://127.0.0.1:${PORT}`;
const BINARY = "/opt/opencode/bin/opencode";
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

type FetchCall = { readonly url: string; readonly init: RequestInit | undefined };

async function launchRequest(overrides: { resumeSessionId?: string; model?: string } = {}) {
  const projectDir = await mkdtemp(join(tmpdir(), "zks-proj-"));
  return {
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    projectDir,
    runDir: await mkdtemp(join(tmpdir(), "zks-run-")),
    appPort: 4100,
    nodePath: "/usr/bin/node",
    rulesText: "RULES",
    pluginDir: PLUGIN_DIR,
    studioToolNames: [],
    ...overrides,
  };
}

function sseResponse(envelopes: readonly unknown[]): Response {
  const body = envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function fakeFetch(streams: Response[][]): { readonly fetch: typeof fetch; readonly calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init });
    if (url.endsWith("/api/event")) return streams.shift()?.[0] ?? new Promise<Response>(() => undefined);
    return new Response("{}", { status: 200 });
  };
  return { fetch: fetchImpl, calls };
}

const adapterWith = (fetchImpl: typeof fetch = fakeFetch([]).fetch) =>
  createOpenCodeAdapter({ parentEnv: PARENT_ENV, findFreePort: async () => PORT, fetch: fetchImpl, reconnectDelayMs: 1 });

describe("opencode adapter: launch", () => {
  it("attaches the TUI to a password-protected local server that loads only the studio's config", async () => {
    const request = await launchRequest({ model: "openai/gpt-5.6-luna" });
    const launch = await adapterWith().prepare(request, TOKENS, BINARY);
    const password = launch.env["OPENCODE_SERVER_PASSWORD"] ?? "";
    const isolation = {
      OPENCODE_CONFIG_DIR: launch.filesDir,
      OPENCODE_DISABLE_PROJECT_CONFIG: "1",
      OPENCODE_DISABLE_CLAUDE_CODE: "1",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    };

    expect(password.length).toBeGreaterThanOrEqual(32);
    expect(launch.file).toBe(BINARY);
    expect(launch.args).toEqual([request.projectDir, "--server", SERVER_URL, "--session", expect.stringMatching(/^ses_[0-9A-Za-z]{26}$/)]);
    expect(launch.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      XDG_DATA_HOME: "/home/user/.local/share",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      OPENCODE_SERVER_PASSWORD: password,
      ...isolation,
    });
    expect(launch.companion?.file).toBe(BINARY);
    expect(launch.companion?.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", String(PORT)]);
    expect(launch.companion?.env).toEqual({ ...launch.env, ZKS_MCP_TOKEN: "mcp-secret", ZKS_MCP_URL: TOKENS.mcpUrl });
    expect([...launch.args, ...(launch.companion?.args ?? [])].join(" ")).not.toMatch(new RegExp(`${password}|mcp-secret|hook-secret`));
  });

  it("writes a deny-by-default config whose only tools are the studio's and project reads", async () => {
    const launch = await adapterWith().prepare(await launchRequest({ model: "openai/gpt-5.6-luna" }), TOKENS, BINARY);
    const configPath = join(launch.filesDir, "opencode.json");
    const instructionsPath = join(launch.filesDir, "instructions.md");

    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual({
      $schema: "https://opencode.ai/config.json",
      share: "disabled",
      autoupdate: false,
      model: "openai/gpt-5.6-luna",
      mcp: {
        studio: {
          type: "local",
          command: ["/usr/bin/node", MCP_SERVER_PATH],
          environment: { ZKS_MCP_TOKEN: "{env:ZKS_MCP_TOKEN}", ZKS_MCP_URL: "{env:ZKS_MCP_URL}" },
        },
      },
      permission: OPENCODE_PERMISSIONS,
      instructions: [instructionsPath],
    });
    expect(OPENCODE_PERMISSIONS).toEqual({ "*": "deny", "studio_*": "allow", read: "allow", external_directory: "deny" });
    expect(await readFile(instructionsPath, "utf8")).toContain("read_skill");
    expect(await modeOf(launch.filesDir)).toBe(0o700);
    expect(await modeOf(configPath)).toBe(0o600);
    expect(await modeOf(instructionsPath)).toBe(0o600);
  });

  it("resumes the user's opencode session by its id", async () => {
    const launch = await adapterWith().prepare(await launchRequest({ resumeSessionId: "ses_e7a5fa25affeTP3sSSc7cugkTa" }), TOKENS, BINARY);
    expect(launch.args.at(-1)).toBe("ses_e7a5fa25affeTP3sSSc7cugkTa");
  });

  it("waits for the server to answer with the password before the TUI attaches", async () => {
    const calls: FetchCall[] = [];
    let attempts = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      attempts += 1;
      if (attempts < 3) throw new TypeError("connection refused");
      return new Response("{}", { status: 200 });
    };
    const launch = await adapterWith(fetchImpl).prepare(await launchRequest(), TOKENS, BINARY);
    await launch.companion?.isReady(new AbortController().signal);

    const password = launch.env["OPENCODE_SERVER_PASSWORD"] ?? "";
    expect(calls.at(-1)?.url).toBe(`${SERVER_URL}/api/config`);
    expect(new Headers(calls.at(-1)?.init?.headers).get("authorization")).toBe(`Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`);
  });

  it("gives up waiting when the session is cancelled", async () => {
    const refused: typeof fetch = async () => Promise.reject(new TypeError("connection refused"));
    const launch = await adapterWith(refused).prepare(await launchRequest(), TOKENS, BINARY);
    await expect(launch.companion?.isReady(AbortSignal.timeout(50))).rejects.toThrow();
  });
});

describe("opencode adapter: events", () => {
  async function subscribeWith(streams: Response[][]): Promise<{
    readonly events: NewStudioEvent[];
    readonly calls: FetchCall[];
    readonly launch: PreparedLaunch;
    readonly stop: () => void;
    readonly sessionId: string;
  }> {
    const fake = fakeFetch(streams);
    const adapter = adapterWith(fake.fetch);
    const launch = await adapter.prepare(await launchRequest(), TOKENS, BINARY);
    if (adapter.events.kind !== "stream") throw new Error("opencode reports through its event stream");
    const events: NewStudioEvent[] = [];
    const stop = adapter.events.subscribe(launch, { projectId: PROJECT_ID, model: "openai/gpt-5.6-luna" }, (published) => events.push(...published));
    return { events, calls: fake.calls, launch, stop, sessionId: launch.args.at(-1) ?? "" };
  }

  it("maps a turn: prompt, tool call, result, text, usage and the end", async () => {
    const { events, stop, sessionId } = await subscribeWith([]);
    stop();
    const turn = await subscribeWithTurn(sessionId);
    await waitFor(() => turn.events.some((event) => event.type === "terminal.state" && event.state === "ready" && turn.events.length > 3), 5_000);
    turn.stop();
    expect(events).toEqual([]);
    expect(turn.events).toEqual([
      { type: "session.started", projectId: PROJECT_ID, sessionId, model: "openai/gpt-5.6-luna", credential: "your OpenCode sign-in", skills: [] },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
      { type: "prompt.submitted", projectId: PROJECT_ID, text: "cut it" },
      { type: "terminal.state", projectId: PROJECT_ID, state: "working" },
      {
        type: "tool.called",
        projectId: PROJECT_ID,
        toolUseId: "call_1",
        name: "mcp__studio__project_info",
        label: expect.any(String),
        input: { verbose: true },
      },
      { type: "tool.finished", projectId: PROJECT_ID, toolUseId: "call_1", ok: true, summary: "two clips" },
      { type: "tool.called", projectId: PROJECT_ID, toolUseId: "call_2", name: "read", label: expect.any(String), input: { filePath: "/etc/passwd" } },
      { type: "tool.finished", projectId: PROJECT_ID, toolUseId: "call_2", ok: false, summary: "Permission denied: external_directory" },
      { type: "tool.denied", projectId: PROJECT_ID, name: "read", reason: "Permission denied: external_directory" },
      { type: "narration", projectId: PROJECT_ID, text: "Two clips found." },
      { type: "usage.reported", projectId: PROJECT_ID, sessionId, source: "opencode", costUsd: 0, inputTokens: 2748, outputTokens: 396, cacheTokens: 3584 },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
  });

  async function subscribeWithTurn(sessionId: string) {
    const scoped = (type: string, data: Record<string, unknown>) => ({ id: `evt_${type}`, type, data: { sessionID: sessionId, ...data } });
    const turnEnvelopes = [
      { id: "evt_0", type: "server.connected", data: {} },
      scoped("session.inbox.enqueued", { item: { type: "user", payload: { text: "cut it" } } }),
      scoped("session.execution.started", {}),
      scoped("session.tool.input.started", { id: "call_1", name: "studio_project_info" }),
      scoped("session.tool.called", { id: "call_1", input: { verbose: true } }),
      scoped("session.tool.success", { id: "call_1", content: [{ type: "text", text: "two clips" }] }),
      scoped("session.tool.input.started", { id: "call_2", name: "read" }),
      scoped("session.tool.called", { id: "call_2", input: { filePath: "/etc/passwd" } }),
      scoped("session.tool.failed", { id: "call_2", error: { type: "permission.rejected", message: "Permission denied: external_directory" } }),
      { id: "evt_other", type: "session.text.ended", data: { sessionID: "ses_someoneelse0000000000000", text: "not ours" } },
      scoped("session.text.ended", { text: "Two clips found.", native: { phase: "final_answer" } }),
      scoped("session.usage.updated", { cost: 0, tokens: { input: 2748, output: 218, reasoning: 178, cache: { read: 3584, write: 0 } } }),
      scoped("session.execution.succeeded", {}),
    ];
    return subscribeWithSession(sessionId, [[sseResponse(turnEnvelopes)]]);
  }

  async function subscribeWithSession(sessionId: string, streams: Response[][]) {
    const fake = fakeFetch(streams);
    const adapter = adapterWith(fake.fetch);
    const launch = await adapter.prepare(await launchRequest({ resumeSessionId: sessionId }), TOKENS, BINARY);
    if (adapter.events.kind !== "stream") throw new Error("opencode reports through its event stream");
    const events: NewStudioEvent[] = [];
    const stop = adapter.events.subscribe(launch, { projectId: PROJECT_ID, model: "openai/gpt-5.6-luna" }, (published) => events.push(...published));
    return { events, calls: fake.calls, stop };
  }

  it("rejects every permission request and reports the tool as denied", async () => {
    const sessionId = "ses_e7a5fa25affeTP3sSSc7cugkTa";
    const asked = { id: "evt_1", type: "permission.asked", data: { id: "per_1", sessionID: sessionId, action: "bash", resources: ["*"], metadata: {} } };
    const { events, calls, stop } = await subscribeWithSession(sessionId, [[sseResponse([asked])]]);
    await waitFor(() => calls.some((call) => call.url.includes("/permission/")), 5_000);
    stop();

    const reply = calls.find((call) => call.url.includes("/permission/"));
    expect(reply?.url).toBe(`${SERVER_URL}/api/session/${sessionId}/permission/per_1/reply`);
    expect(reply?.init?.method).toBe("POST");
    expect(JSON.parse(String(reply?.init?.body))).toEqual({ decision: "reject" });
    expect(events).toContainEqual({ type: "tool.denied", projectId: PROJECT_ID, name: "bash", reason: "bash is not available in ZKidz Studio." });
  });

  it("reconnects after the stream drops, without starting the session twice", async () => {
    const sessionId = "ses_e7a5fa25affeTP3sSSc7cugkTa";
    const connected = { id: "evt_0", type: "server.connected", data: {} };
    const later = { id: "evt_2", type: "session.execution.started", data: { sessionID: sessionId } };
    const { events, calls, stop } = await subscribeWithSession(sessionId, [
      [sseResponse([connected])],
      [new Response("oops", { status: 503 })],
      [sseResponse([connected, later])],
    ]);
    await waitFor(() => events.some((event) => event.type === "terminal.state" && event.state === "working"), 5_000);
    stop();

    // The third stream also ends, so a fourth connection may already be open.
    expect(calls.filter((call) => call.url.endsWith("/api/event")).length).toBeGreaterThanOrEqual(3);
    expect(events.filter((event) => event.type === "session.started")).toHaveLength(1);
  });
});
