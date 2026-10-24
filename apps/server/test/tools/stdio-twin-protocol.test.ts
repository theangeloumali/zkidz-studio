// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const TWIN_PATH = fileURLToPath(new URL("../../bin/zks-mcp.mjs", import.meta.url));
// Prints every non-builtin module the twin resolves, so a test sees its load graph.
const REPORT_LOADS = `data:text/javascript,import{registerHooks}from"node:module";registerHooks({resolve(s,c,n){const r=n(s,c);if(!r.url.startsWith("node:"))process.stderr.write("LOADED "+r.url+"\\n");return r}})`;

interface RpcAnswer {
  readonly id: number | null;
  readonly result?: Record<string, unknown>;
  readonly error?: { readonly code: number };
}

// Answered last, so its answer proves every earlier line was read.
const SENTINEL_ID = 99;

/** Sends raw lines and then a sentinel ping to a twin whose server is not there; returns the answers before the ping, and stderr. */
async function exchange(lines: string[]): Promise<{ answers: RpcAnswer[]; stderr: string }> {
  const child = spawn(process.execPath, ["--import", REPORT_LOADS, TWIN_PATH], {
    env: { ZKS_MCP_URL: "http://127.0.0.1:9/mcp/protocol-check", ZKS_MCP_TOKEN: "t".repeat(43) },
  });
  let stdout = "";
  let stderr = "";
  const answersSoFar = () =>
    stdout
      .split("\n")
      .slice(0, -1)
      .map((line) => JSON.parse(line) as RpcAnswer);
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const sentinelAnswered = new Promise<"answered">((resolve) =>
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (answersSoFar().some((answer) => answer.id === SENTINEL_ID)) resolve("answered");
    }),
  );
  try {
    child.stdin.write([...lines, request(SENTINEL_ID, "ping")].map((line) => `${line}\n`).join(""));
    const outcome = await Promise.race([sentinelAnswered, once(child, "exit").then(() => "exited" as const)]);
    if (outcome === "exited") throw new Error(`The twin exited before answering: ${stderr}`);
  } finally {
    child.kill();
  }
  return { answers: answersSoFar().filter((answer) => answer.id !== SENTINEL_ID), stderr };
}

const request = (id: number, method: string, params?: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const initialize = (id: number, protocolVersion: string) =>
  request(id, "initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "t", version: "0" } });

// Spawning node is slow under CI load even when the twin itself loads in milliseconds.
describe("zks-mcp stdio twin protocol", { timeout: 60_000 }, () => {
  // Claude Code spawns the twin per session; each package module costs 9p round trips, and the SDK's 237 took 14-18 s under CI load.
  it("loads no module but itself, so a cold start reads one file", async () => {
    const { stderr } = await exchange([initialize(1, "2025-06-18")]);
    expect([...stderr.matchAll(/^LOADED (.+)$/gm)].map(([, url]) => url)).toEqual([pathToFileURL(TWIN_PATH).href]);
  });

  it("echoes a protocol version it supports and offers its latest for one it does not", async () => {
    const { answers } = await exchange([initialize(1, "2025-06-18"), initialize(2, "1999-01-01")]);
    expect(answers.map((answer) => answer.result?.protocolVersion)).toEqual(["2025-06-18", "2025-11-25"]);
    expect(answers[0]?.result).toMatchObject({ capabilities: { tools: {} }, serverInfo: { name: "studio" } });
  });

  it("answers ping, ignores notifications, and rejects unknown methods, nameless calls and unparseable lines", async () => {
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    const { answers } = await exchange([notification, request(1, "ping"), request(2, "resources/list"), request(3, "tools/call", {}), "{not json"]);
    const byId = (id: number | null) => answers.find((answer) => answer.id === id);
    expect(answers).toHaveLength(4);
    expect(byId(1)?.result).toEqual({});
    expect(byId(2)?.error?.code).toBe(-32601);
    expect(byId(3)?.error?.code).toBe(-32602);
    expect(byId(null)?.error?.code).toBe(-32700);
  });

  // MCP 2025-06-18 dropped JSON-RPC batches, so a batch is one more invalid request.
  it("rejects a batch, a bare value and a methodless request as invalid, and stays silent for the client's own responses", async () => {
    const clientResponse = JSON.stringify({ jsonrpc: "2.0", id: 7, result: {} });
    const { answers } = await exchange([`[${request(1, "ping")}]`, "42", JSON.stringify({ jsonrpc: "2.0", id: 5 }), clientResponse]);
    expect(answers).toEqual([
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } },
      { jsonrpc: "2.0", id: 5, error: { code: -32600, message: "Invalid Request" } },
    ]);
  });
});
