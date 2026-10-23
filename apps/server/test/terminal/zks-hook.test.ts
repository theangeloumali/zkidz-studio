// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const RELAY_PATH = fileURLToPath(new URL("../../bin/zks-hook.mjs", import.meta.url));
const PAYLOAD = JSON.stringify({ session_id: "s", hook_event_name: "SessionStart", source: "startup" });

interface ReceivedRequest {
  readonly authorization: string | undefined;
  readonly contentType: string | undefined;
  readonly body: string;
}

let server: Server | undefined;

afterEach(async () => {
  await new Promise((resolve) => (server === undefined ? resolve(undefined) : server.close(resolve)));
  server = undefined;
});

async function startBridge(status: number, responseBody: string): Promise<{ url: string; received: ReceivedRequest[] }> {
  const received: ReceivedRequest[] = [];
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString("utf8")));
    request.on("end", () => {
      received.push({ authorization: request.headers.authorization, contentType: request.headers["content-type"], body });
      response.writeHead(status, { "content-type": "application/json" }).end(responseBody);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/terminal/s/hooks`, received };
}

function runRelay(hookUrl: string): Promise<{ exitCode: number | null; stdout: string }> {
  const relay = spawn(process.execPath, [RELAY_PATH, hookUrl], { env: { ZKS_HOOK_TOKEN: "hook-token" }, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  relay.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
  relay.stdin.end(PAYLOAD);
  return new Promise((resolve) => relay.on("exit", (exitCode) => resolve({ exitCode, stdout })));
}

describe("bin/zks-hook.mjs", () => {
  it("forwards the hook payload with the session bearer token and prints the bridge's answer", async () => {
    const bridge = await startBridge(200, "{}");
    const { exitCode, stdout } = await runRelay(bridge.url);
    expect(exitCode).toBe(0);
    expect(stdout).toBe("{}");
    expect(bridge.received).toEqual([{ authorization: "Bearer hook-token", contentType: "application/json", body: PAYLOAD }]);
  });

  it("exits 2 when the bridge refuses the request", async () => {
    const bridge = await startBridge(401, JSON.stringify({ error: "unauthorized" }));
    expect((await runRelay(bridge.url)).exitCode).toBe(2);
  });

  it("exits 2 when the bridge denies", async () => {
    const deny = { hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "no" } };
    const bridge = await startBridge(200, JSON.stringify(deny));
    expect((await runRelay(bridge.url)).exitCode).toBe(2);
  });

  it("exits 2 when the bridge is unreachable", async () => {
    const bridge = await startBridge(200, "{}");
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
    expect((await runRelay(bridge.url)).exitCode).toBe(2);
  });
});
