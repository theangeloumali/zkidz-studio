// Created by The Angelo Umali.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudioMcpServer, STUDIO_TOOL_NAMES } from "../../src/tools/index.ts";
import { createTestServer, type TestServer } from "../support/test-server.ts";
import { createToolFixture } from "./tool-fixtures.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("createStudioMcpServer", () => {
  it("serves the studio catalog in process", async () => {
    const fixture = await createToolFixture(server);
    const mcpServer = await createStudioMcpServer(fixture.context);
    expect(mcpServer).toMatchObject({ type: "sdk", name: "studio" });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcpServer.instance.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);

    const { tools } = await client.listTools();
    expect(tools.map((listed) => `mcp__studio__${listed.name}`).sort()).toEqual([...STUDIO_TOOL_NAMES].sort());
    expect(tools.find((listed) => listed.name === "read_transcript")?.annotations?.readOnlyHint).toBe(true);

    const info = await client.callTool({ name: "project_info", arguments: {} });
    expect(info.structuredContent).toMatchObject({ videoId: "v1", clips: [] });
    await client.close();
  });

  it("names only implemented catalog tools", () => {
    expect(STUDIO_TOOL_NAMES).toContain("mcp__studio__set_cuts");
    expect(STUDIO_TOOL_NAMES).toContain("mcp__studio__render_master");
    // The SDK path decides in canUseTool; approve is served only to `claude -p` through the twin.
    expect(STUDIO_TOOL_NAMES).not.toContain("mcp__studio__approve");
  });
});
