// Created by The Angelo Umali.
// Stand-in for the studio stdio twin: one tool, and a log line per start and call so the harness can see it connected.
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const logPath = process.env.ZKS_SPIKE_MCP_LOG;
const log = (event) =>
  appendFileSync(
    logPath,
    JSON.stringify({
      event,
      at: Date.now(),
      tokenPresent: Boolean(process.env.ZKS_MCP_TOKEN),
    }) + "\n",
  );

const server = new McpServer({ name: "studio", version: "0.0.0" });
server.registerTool(
  "ping",
  { description: "Spike tool. Returns pong.", inputSchema: {} },
  async () => {
    log("ping");
    return { content: [{ type: "text", text: "pong" }] };
  },
);

await server.connect(new StdioServerTransport());
log("started");
