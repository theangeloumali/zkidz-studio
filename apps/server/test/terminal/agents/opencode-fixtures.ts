// Created by The Angelo Umali.
// Shared fixtures for the OpenCode adapter tests: a fake `opencode serve` shaped like 2.2.0's answers.
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenCodeAdapter } from "../../../src/terminal/agents/opencode.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
export const PROJECT_ID = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const PLUGIN_DIR = fileURLToPath(new URL("../../../../../plugin/", import.meta.url));
export const TOKENS = { hookToken: "hook-secret", mcpToken: "mcp-secret", mcpUrl: "http://127.0.0.1:4100/mcp/x" };
const PARENT_ENV = {
  PATH: "/usr/bin",
  HOME: "/home/user",
  XDG_CONFIG_HOME: "/home/user/.config",
  XDG_DATA_HOME: "/home/user/.local/share",
  GEMINI_API_KEY: "parent",
};
export const SERVER_URL = "http://127.0.0.1:47123";
const LISTENING = `server listening on ${SERVER_URL}\n`;
export const BINARY = "/opt/opencode/bin/opencode";
export const RESUMED_SESSION = "ses_e7a5fa25affeTP3sSSc7cugkTa";
export const STUDIO_RULES = [
  { action: "*", resource: "*", effect: "deny" },
  { action: "studio_*", resource: "*", effect: "allow" },
  { action: "read", resource: "*", effect: "ask" },
  { action: "external_directory", resource: "*", effect: "deny" },
];
export const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

type FetchCall = { readonly url: string; readonly init: RequestInit | undefined };

export async function launchRequest(overrides: { resumeSessionId?: string; model?: string; projectDir?: string } = {}) {
  return {
    sessionId: SESSION_ID,
    projectId: PROJECT_ID,
    projectDir: await mkdtemp(join(tmpdir(), "zks-proj-")),
    runDir: await mkdtemp(join(tmpdir(), "zks-run-")),
    appPort: 4100,
    nodePath: "/usr/bin/node",
    rulesText: "RULES",
    pluginDir: PLUGIN_DIR,
    studioToolNames: [],
    ...overrides,
  };
}

/** The config sources opencode 2.2.0 reports when only the studio's folder is loaded. */
export const studioSources = (filesDir: string) => [
  { type: "document", path: join(filesDir, "opencode.json"), info: { permissions: STUDIO_RULES, mcp: { servers: { studio: { type: "local" } } } } },
  { type: "directory", path: filesDir },
];

/** What a locked-down `opencode serve` answers, shaped like opencode 2.2.0's own responses. */
function lockedDownAnswers(filesDir: string): Map<string, unknown> {
  return new Map<string, unknown>([
    ["/api/config", studioSources(filesDir)],
    [
      "/api/agent",
      {
        data: [
          {
            id: "build",
            permissions: [{ action: "*", resource: "*", effect: "allow" }, ...STUDIO_RULES, { action: "browser", resource: "*", effect: "deny" }],
          },
        ],
      },
    ],
    ["/api/plugin", { data: [{ id: "opencode.tool.read", source: { type: "builtin" }, state: { status: "active" } }] }],
    ["/api/permission/saved", { data: [] }],
  ]);
}

export function sseResponse(envelopes: readonly unknown[]): Response {
  const body = envelopes.map((envelope) => `data: ${JSON.stringify(envelope)}\n\n`).join("");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function fakeServer(streams: Response[][] = []) {
  const calls: FetchCall[] = [];
  const answers = new Map<string, unknown>();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    const { pathname } = new URL(url);
    if (pathname === "/api/event") return streams.shift()?.[0] ?? new Promise<Response>(() => undefined);
    if (init?.method === "POST") return new Response(null, { status: 204 });
    const answer = answers.get(pathname);
    return answer === undefined ? new Response("missing", { status: 404 }) : new Response(JSON.stringify(answer), { status: 200 });
  };
  return { fetch: fetchImpl, calls, answers };
}

type FakeServer = ReturnType<typeof fakeServer>;

/** A companion stdout that prints `chunks`, then closes. */
export function printed(...chunks: readonly string[]): AsyncIterable<Uint8Array> {
  const iterator = chunks.map((chunk) => Buffer.from(chunk)).values();
  return { [Symbol.asyncIterator]: () => ({ next: () => Promise.resolve(iterator.next()) }) };
}

/** A companion stdout that never prints. */
export const silent = (): AsyncIterable<Uint8Array> => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => undefined) }) });

export const adapterWith = (server: FakeServer = fakeServer()) => createOpenCodeAdapter({ parentEnv: PARENT_ENV, fetch: server.fetch, reconnectDelayMs: 1 });

/** Prepares, lets `edit` change what the server answers, then connects as the session would. */
export async function connectWith(
  server: FakeServer,
  options: { output?: AsyncIterable<Uint8Array>; edit?: (answers: Map<string, unknown>, filesDir: string) => void; projectDir?: string } = {},
) {
  const adapter = adapterWith(server);
  const request = await launchRequest({ resumeSessionId: RESUMED_SESSION, ...(options.projectDir === undefined ? {} : { projectDir: options.projectDir }) });
  const prepared = await adapter.prepare(request, TOKENS, BINARY);
  if (prepared.companion === undefined) throw new Error("opencode runs a companion server");
  lockedDownAnswers(prepared.filesDir).forEach((answer, path) => server.answers.set(path, answer));
  options.edit?.(server.answers, prepared.filesDir);
  const connect = () => prepared.companion?.connect(options.output ?? printed(LISTENING), AbortSignal.timeout(2_000));
  return { adapter, request, prepared, connect };
}
