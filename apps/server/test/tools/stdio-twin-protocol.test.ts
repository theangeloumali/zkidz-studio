// Created by The Angelo Umali.
import { spawn } from "node:child_process";
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

/** Sends raw lines to a twin whose server is not there and returns its answers and stderr. */
async function exchange(lines: string[], expectedAnswers: number): Promise<{ answers: RpcAnswer[]; stderr: string }> {
  const child = spawn(process.execPath, ["--import", REPORT_LOADS, TWIN_PATH], {
    env: { ZKS_MCP_URL: "http://127.0.0.1:9/mcp/protocol-check", ZKS_MCP_TOKEN: "t".repeat(43) },
  });
  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
  const done = new Promise<void>((resolve) =>
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.split("\n").length > expectedAnswers) resolve();
    }),
  );
  child.stdin.write(lines.map((line) => `${line}\n`).join(""));
  await done;
  child.kill();
  const answers = stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RpcAnswer);
  return { answers, stderr };
}

const request = (id: number, method: string, params?: Record<string, unknown>) => JSON.stringify({ jsonrpc: "2.0", id, method, params });
const initialize = (id: number, protocolVersion: string) =>
  request(id, "initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "t", version: "0" } });

// Spawning node is slow under CI load even when the twin itself loads in milliseconds.
describe("zks-mcp stdio twin protocol", { timeout: 60_000 }, () => {
  // Claude Code spawns the twin per session; each package module costs 9p round trips, and the SDK's 237 took 14-18 s under CI load.
  it("loads no module but itself, so a cold start reads one file", async () => {
    const { stderr } = await exchange([initialize(1, "2025-06-18")], 1);
    expect([...stderr.matchAll(/^LOADED (.+)$/gm)].map(([, url]) => url)).toEqual([pathToFileURL(TWIN_PATH).href]);
  });

  it("echoes a protocol version it supports and offers its latest for one it does not", async () => {
    const { answers } = await exchange([initialize(1, "2025-06-18"), initialize(2, "1999-01-01")], 2);
    expect(answers.map((answer) => answer.result?.protocolVersion)).toEqual(["2025-06-18", "2025-11-25"]);
    expect(answers[0]?.result).toMatchObject({ capabilities: { tools: {} }, serverInfo: { name: "studio" } });
  });

  it("answers ping, ignores notifications, and rejects unknown methods, nameless calls and unparseable lines", async () => {
    const notification = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    const { answers } = await exchange([notification, request(1, "ping"), request(2, "resources/list"), request(3, "tools/call", {}), "{not json"], 4);
    const byId = (id: number | null) => answers.find((answer) => answer.id === id);
    expect(answers).toHaveLength(4);
    expect(byId(1)?.result).toEqual({});
    expect(byId(2)?.error?.code).toBe(-32601);
    expect(byId(3)?.error?.code).toBe(-32602);
    expect(byId(null)?.error?.code).toBe(-32700);
  });
});
