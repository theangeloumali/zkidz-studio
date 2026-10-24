#!/usr/bin/env node
// Created by The Angelo Umali.
// The studio MCP stdio twin for terminal mode (plan §6.3, §6.7): a thin proxy that holds no tool logic.
// Every list and call goes to the local server over loopback HTTP with the per-session bearer token, so with
// the server stopped no tool runs. It speaks MCP's newline-delimited JSON-RPC itself, importing only node builtins:
// Claude Code spawns it per session, and the SDK's 237 modules took 14-18 s to load on a /mnt/c checkout.
import { Buffer } from "node:buffer";
import { request } from "node:http";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NOT_RUNNING = "ZKidz Studio is not running, so no studio tool can run. Ask the user to start it.";
// As @modelcontextprotocol/sdk 1.32.1 negotiates: echo a supported version, else offer the latest.
const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05", "2024-10-07"];
const MAX_LINE_BYTES = 10 * 1024 * 1024;

function readEndpoint() {
  const token = process.env.ZKS_MCP_TOKEN;
  const endpoint = URL.parse(process.env.ZKS_MCP_URL ?? "");
  // The token must never leave this machine, whatever the config file says.
  if (!token || endpoint === null || endpoint.protocol !== "http:" || !LOOPBACK_HOSTS.has(endpoint.hostname)) {
    process.stderr.write("zks-mcp: ZKS_MCP_URL must be a loopback http URL and ZKS_MCP_TOKEN must be set\n");
    process.exit(2);
  }
  return { token, baseUrl: endpoint.href.replace(/\/$/, "") };
}

// node:http rather than fetch: an approval or a cut review can wait on the user far past fetch's header timeout.
function callServer(endpoint, { method, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const headers = { authorization: `Bearer ${endpoint.token}`, ...(payload === undefined ? {} : { "content-type": "application/json" }) };
    const outgoing = request(`${endpoint.baseUrl}${path}`, { method, headers }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end(payload);
  });
}

function errorResult(text) {
  return { content: [{ type: "text", text }], isError: true };
}

function refusalOf(response) {
  if (response.status === 401) return "The studio server refused this session's token.";
  if (response.status === 409) return "The Claude Code session is not ready yet: finish signing in first.";
  return `The studio server answered ${response.status}.`;
}

async function listTools(endpoint) {
  const response = await callServer(endpoint, { method: "GET", path: "/tools" }).catch(() => null);
  if (response === null || response.status !== 200) return { tools: [] };
  return JSON.parse(response.body);
}

async function callTool(endpoint, params) {
  const body = { name: params.name, arguments: params.arguments ?? {} };
  const response = await callServer(endpoint, { method: "POST", path: "/call", body }).catch(() => null);
  if (response === null) return errorResult(NOT_RUNNING);
  if (response.status !== 200) return errorResult(refusalOf(response));
  return JSON.parse(response.body);
}

function initialize(params) {
  const requested = params?.protocolVersion;
  const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
  return { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "studio", version: "0.1.0" } };
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}

function handle(endpoint, method, params) {
  if (method === "initialize") return initialize(params);
  if (method === "ping") return {};
  if (method === "tools/list") return listTools(endpoint);
  if (method !== "tools/call") throw rpcError(-32601, `Method not found: ${method}`);
  if (typeof params?.name !== "string") throw rpcError(-32602, "tools/call needs a tool name");
  return callTool(endpoint, params);
}

function send(message) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

async function answer(endpoint, line) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return send({ id: null, error: { code: -32700, message: "Parse error" } });
  }
  // Notifications and the client's own responses carry no id to answer.
  if (message?.id === undefined || typeof message.method !== "string") return;
  try {
    send({ id: message.id, result: await handle(endpoint, message.method, message.params) });
  } catch (error) {
    send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
  }
}

const endpoint = readEndpoint();
let buffered = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffered += chunk;
  let newline;
  while ((newline = buffered.indexOf("\n")) !== -1) {
    const line = buffered.slice(0, newline).replace(/\r$/, "");
    buffered = buffered.slice(newline + 1);
    if (line.trim() !== "") void answer(endpoint, line);
  }
  // The SDK transport's cap: an unterminated line this long is not a message.
  if (Buffer.byteLength(buffered) > MAX_LINE_BYTES) {
    buffered = "";
    process.stderr.write("zks-mcp: dropped an unterminated message over 10 MB\n");
  }
});
