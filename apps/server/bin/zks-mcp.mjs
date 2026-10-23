#!/usr/bin/env node
// Created by The Angelo Umali.
// The studio MCP stdio twin for terminal mode (plan §6.3, §6.7): a thin proxy that holds no tool logic.
// Every list and call goes to the local server over loopback HTTP with the per-session bearer token, so with
// the server stopped no tool runs.
import { Buffer } from "node:buffer";
import { request } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);
const NOT_RUNNING = "ZKidz Studio is not running, so no studio tool can run. Ask the user to start it.";

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

const endpoint = readEndpoint();
const server = new Server({ name: "studio", version: "0.1.0" }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const response = await callServer(endpoint, { method: "GET", path: "/tools" }).catch(() => null);
  if (response === null || response.status !== 200) return { tools: [] };
  return JSON.parse(response.body);
});

server.setRequestHandler(CallToolRequestSchema, async (call) => {
  const body = { name: call.params.name, arguments: call.params.arguments ?? {} };
  const response = await callServer(endpoint, { method: "POST", path: "/call", body }).catch(() => null);
  if (response === null) return errorResult(NOT_RUNNING);
  if (response.status !== 200) return errorResult(refusalOf(response));
  return JSON.parse(response.body);
});

await server.connect(new StdioServerTransport());
