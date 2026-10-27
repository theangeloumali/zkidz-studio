// Created by The Angelo Umali.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve, type ServerType } from "@hono/node-server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildAgentEnv } from "../../src/auth/agent-env.ts";
import { createRequestGuard } from "../../src/security/request-guards.ts";
import { createSessionToken } from "../../src/security/token.ts";
import { writeSessionFiles } from "../../src/terminal/session-files.ts";
import { implementTool, studioTwinCatalog } from "../../src/tools/catalog.ts";
import { studioMcpUrl } from "../../src/tools/mcp-paths.ts";
import { registerStudioToolRoutes, type StudioToolSession } from "../../src/tools/routes.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { fakeEngine, withEngine } from "./fake-engine.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset, type ToolFixture } from "./tool-fixtures.ts";

const TWIN_PATH = fileURLToPath(new URL("../../bin/zks-mcp.mjs", import.meta.url));
const SESSION_TOKEN = "t".repeat(43);
const UNUSED_PREVIEW_PORT = 9;
const deleteAssetCalls: string[] = [];
const fakeDeleteAsset = implementTool("delete_asset", {
  description: "Test double for a gated tool.",
  handler: (input) => {
    deleteAssetCalls.push(input.assetId);
    return Promise.resolve({ output: { ok: true } });
  },
});

let server: TestServer;
let httpServer: ServerType;
let port = 0;
const sessions = new Map<string, StudioToolSession>();

beforeAll(async () => {
  server = await createTestServer();
  const app = new Hono();
  await new Promise<void>((resolve) => {
    httpServer = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (address) => {
      port = address.port;
      resolve();
    });
  });
  // The guard's Host allowlist needs the real port, so the routes mount once it is known.
  app.use("/api/*", createRequestGuard({ appPort: port, previewPort: UNUSED_PREVIEW_PORT, csrfToken: createSessionToken() }));
  registerStudioToolRoutes(app, {
    findSession: (sessionId) => sessions.get(sessionId),
    tokensMatch: (expected, presented) => expected === presented,
    tools: [...studioTwinCatalog().filter((studioTool) => studioTool.name !== "delete_asset"), fakeDeleteAsset],
  });
});
afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
  await server.close();
});

async function connectTwin(sessionId: string, token = SESSION_TOKEN, twinPort = port) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [TWIN_PATH],
    env: { ZKS_MCP_URL: studioMcpUrl(twinPort, sessionId), ZKS_MCP_TOKEN: token },
    stderr: "ignore",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

function addSession(fixture: ToolFixture, isReady = true): string {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { token: SESSION_TOKEN, context: fixture.context, isReady: () => isReady });
  return sessionId;
}

// Each test spawns node and writes PGlite fixtures, which both slow sharply under CI load.
describe("zks-mcp stdio twin", { timeout: 60_000 }, () => {
  it("lists the catalog and runs tools through the server", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    const client = await connectTwin(addSession(fixture));
    const { tools } = await client.listTools();
    expect(tools.map((listed) => listed.name)).toContain("set_cuts");

    const stored = await client.callTool({ name: "set_cuts", arguments: { cuts: cutSpecFor(asset.id) } });
    expect(stored.structuredContent).toMatchObject({ version: 1 });
    const escaped = await client.callTool({ name: "set_cuts", arguments: { cuts: { ...cutSpecFor(asset.id), source: "/etc/passwd" } } });
    expect(escaped.isError).toBe(true);
    await client.close();
  });

  it("carries render_preview's PNG image blocks through unchanged", async () => {
    const png = Buffer.from("png bytes");
    const { engine } = fakeEngine(async (request) => {
      await mkdir(join(request.workDir, "stills"), { recursive: true });
      await writeFile(join(request.workDir, "stills", "t1.png"), png);
      return { stills: [{ at: 1, path: "stills/t1.png" }] };
    });
    const fixture = withEngine(await createToolFixture(server), engine);
    const asset = await insertCameraAsset(fixture);
    const client = await connectTwin(addSession(fixture));
    expect((await client.callTool({ name: "set_cuts", arguments: { cuts: cutSpecFor(asset.id) } })).isError).toBeFalsy();
    const preview = await client.callTool({ name: "render_preview", arguments: { at: [1] } });
    expect(preview.structuredContent).toEqual({ stills: [{ at: 1, path: "work/stills/t1.png" }] });
    expect(preview.content).toContainEqual({ type: "image", data: png.toString("base64"), mimeType: "image/png" });
    await client.close();
  });

  it("lists the tools before the session is ready but refuses calls until then, and refuses a wrong token", async () => {
    const fixture = await createToolFixture(server);
    const wrongToken = await connectTwin(addSession(fixture), "x".repeat(43));
    expect((await wrongToken.callTool({ name: "project_info", arguments: {} })).isError).toBe(true);
    await wrongToken.close();

    const notReady = await connectTwin(addSession(fixture, false));
    // Claude Code lists the tools before its SessionStart hook, and an empty list left the session without them.
    expect((await notReady.listTools()).tools.map((listed) => listed.name)).toContain("project_info");
    const refused = await notReady.callTool({ name: "project_info", arguments: {} });
    expect(JSON.stringify(refused.content)).toMatch(/not ready/i);
    await notReady.close();
  });

  it("blocks a gated tool until the user decides, on a card of server-derived facts", async () => {
    let allow: (decision: "allow" | "deny") => void = () => undefined;
    const fixture = await createToolFixture(server, () => new Promise((resolve) => (allow = resolve)));
    const asset = await insertCameraAsset(fixture);
    const client = await connectTwin(addSession(fixture));
    const pending = client.callTool({ name: "delete_asset", arguments: { assetId: asset.id } });
    await expect.poll(() => fixture.approvalCards.length).toBe(1);
    expect(fixture.approvalCards[0]).toEqual({
      tool: "mcp__studio__delete_asset",
      facts: { action: "Delete a media asset", target: asset.id, outputPaths: [], filesToDelete: [join(fixture.projectRoot, asset.relPath ?? "")] },
    });
    expect(deleteAssetCalls).not.toContain(asset.id);
    allow("allow");
    expect((await pending).isError).toBeUndefined();
    expect(deleteAssetCalls).toContain(asset.id);
    await client.close();
  });

  it("rejects gated input that fails its contract, or names another project's asset, before any card", async () => {
    const fixture = await createToolFixture(server, () => Promise.resolve("allow"));
    const client = await connectTwin(addSession(fixture));
    const malformed = await client.callTool({ name: "delete_asset", arguments: { assetId: 42 } });
    const foreign = await client.callTool({ name: "delete_asset", arguments: { assetId: crypto.randomUUID() } });
    expect(malformed.isError).toBe(true);
    expect(foreign.isError).toBe(true);
    expect(fixture.approvalCards).toEqual([]);
    await client.close();
  });

  it("cancels the card when the twin's request drops", async () => {
    const fixture = await createToolFixture(server, (_card, signal) => new Promise((resolve) => signal?.addEventListener("abort", () => resolve("deny"))));
    const asset = await insertCameraAsset(fixture);
    const sessionId = addSession(fixture);
    const dropped = new AbortController();
    const call = fetch(`${studioMcpUrl(port, sessionId)}/call`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SESSION_TOKEN}` },
      body: JSON.stringify({ name: "delete_asset", arguments: { assetId: asset.id } }),
      signal: dropped.signal,
    }).catch(() => "dropped");
    await expect.poll(() => fixture.approvalSignals.length).toBe(1);
    dropped.abort();
    expect(await call).toBe("dropped");
    await expect.poll(() => fixture.approvalSignals[0]?.aborted).toBe(true);
    expect(deleteAssetCalls).not.toContain(asset.id);
  });

  it("runs nothing when the server is not there", async () => {
    const fixture = await createToolFixture(server);
    const client = await connectTwin(addSession(fixture), SESSION_TOKEN, 1);
    const result = await client.callTool({ name: "project_info", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toMatch(/not running/i);
    await client.close();
  });

  it("returns 401 to a call without the bearer token", async () => {
    const fixture = await createToolFixture(server);
    const sessionId = addSession(fixture);
    const response = await fetch(`${studioMcpUrl(port, sessionId)}/call`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "project_info", arguments: {} }),
    });
    expect(response.status).toBe(401);
  });

  it("reaches the tools through the MCP config and env a mode T launch writes", async () => {
    const fixture = await createToolFixture(server);
    const sessionId = addSession(fixture);
    const runDir = await mkdtemp(join(tmpdir(), "zks-twin-wiring-"));
    try {
      const files = await writeSessionFiles({
        runDir,
        sessionId,
        appPort: port,
        nodePath: process.execPath,
        hookRelayPath: "/unused/zks-hook.mjs",
        mcpServerPath: TWIN_PATH,
        rulesText: "",
      });
      const childEnv = buildAgentEnv(
        { kind: "terminal", tokens: { hookToken: "h".repeat(43), mcpToken: SESSION_TOKEN, mcpUrl: files.mcpUrl } },
        { studioHome: runDir, appVersion: "0.0.0", proxyOptIn: false, parentEnv: {} },
      );
      const config = JSON.parse(await readFile(files.mcpConfigPath, "utf8")) as McpConfigFile;
      const studio = config.mcpServers.studio;
      // Claude Code expands ${VAR} in the MCP config from the child env.
      const twinEnv = Object.fromEntries(
        Object.entries(studio.env).map(([name, value]) => [name, value.replace(/^\$\{(\w+)\}$/, (_match, variable: string) => childEnv[variable] ?? "")]),
      );
      const transport = new StdioClientTransport({ command: studio.command, args: studio.args, env: twinEnv, stderr: "ignore" });
      const client = new Client({ name: "test", version: "0.0.0" });
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools.map((listed) => listed.name)).toContain("project_info");
      await client.close();
    } finally {
      await rm(runDir, { recursive: true, force: true });
    }
  });
});

// The payload `claude -p --permission-prompt-tool` sends, captured from Claude Code 2.1.309 (plan §6.7).
async function askApprove(client: Client, toolName: string, input: Record<string, unknown>) {
  const result = await client.callTool({ name: "approve", arguments: { tool_name: toolName, input, tool_use_id: "toolu_test" } });
  const [first] = result.content as { type: string; text: string }[];
  return { isError: result.isError, decision: JSON.parse(first?.text ?? "null") as unknown };
}

describe("approve, the -p fallback's permission prompt tool", { timeout: 60_000 }, () => {
  it("lets studio tools through without a card, since the gated ones raise theirs when they run", async () => {
    const fixture = await createToolFixture(server);
    const client = await connectTwin(addSession(fixture));
    const { tools } = await client.listTools();
    expect(tools.find((listed) => listed.name === "approve")?.inputSchema.required).toEqual(["tool_name", "input"]);
    for (const toolName of ["mcp__studio__set_cuts", "mcp__studio__delete_asset", "Read", "Skill"]) {
      const { isError, decision } = await askApprove(client, toolName, { assetId: "a" });
      expect(isError).toBeUndefined();
      expect(decision).toEqual({ behavior: "allow", updatedInput: { assetId: "a" } });
    }
    expect(fixture.approvalCards).toEqual([]);
    await client.close();
  });

  it("denies anything else with a reason and no card", async () => {
    const fixture = await createToolFixture(server, () => Promise.resolve("allow"));
    const client = await connectTwin(addSession(fixture));
    for (const toolName of ["Bash", "mcp__other__thing", "mcp__studio__approve"]) {
      expect((await askApprove(client, toolName, {})).decision).toEqual({ behavior: "deny", message: "This tool is not available in the studio" });
    }
    expect(fixture.approvalCards).toEqual([]);
    await expect.poll(() => fixture.events.filter((event) => event.type === "tool.denied").length).toBe(3);
    await client.close();
  });

  it("answers AskUserQuestion from a question card", async () => {
    const fixture = await createToolFixture(server, undefined, () => Promise.resolve({ "Which take?": "The second" }));
    const client = await connectTwin(addSession(fixture));
    const questions = [{ question: "Which take?", options: [{ label: "The first" }, { label: "The second" }] }];
    const { decision } = await askApprove(client, "AskUserQuestion", { questions });
    expect(fixture.askedQuestions).toEqual([questions]);
    expect(decision).toEqual({ behavior: "allow", updatedInput: { questions, answers: { "Which take?": "The second" } } });

    const malformed = await askApprove(client, "AskUserQuestion", { questions: [] });
    expect(malformed.decision).toMatchObject({ behavior: "deny" });
    await client.close();
  });

  it("denies a dismissed question", async () => {
    const fixture = await createToolFixture(server);
    const client = await connectTwin(addSession(fixture));
    const { decision } = await askApprove(client, "AskUserQuestion", { questions: [{ question: "Ok?", options: [{ label: "Yes" }] }] });
    expect(decision).toEqual({ behavior: "deny", message: "The question was dismissed" });
    await client.close();
  });
});

interface McpConfigFile {
  readonly mcpServers: { readonly studio: { readonly command: string; readonly args: string[]; readonly env: Record<string, string> } };
}
