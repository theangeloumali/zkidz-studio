// Created by The Angelo Umali.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, CSRF_HEADER } from "@zks/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentServices, type AgentServices } from "../../src/agent-services.ts";
import type { QueryFunction } from "../../src/agent/query-function.ts";
import { writeConnection } from "../../src/auth/connection-store.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import { projectDir } from "../../src/config.ts";
import { createSecurity } from "../../src/security/index.ts";
import { memoryKeyring } from "../auth/memory-keyring.ts";
import { connectionFrom, createTestServer, insertProject, TEST_HOST, type TestServer } from "../support/test-server.ts";
import { waitFor } from "../terminal/stub-claude.ts";

// Counts in-process MCP servers built; the -p child reaches the HTTP twin, so it must never get one.
const mcpServersBuilt = vi.hoisted(() => ({ count: 0 }));
vi.mock("../../src/tools/index.ts", async (importOriginal) => {
  const tools = await importOriginal<typeof import("../../src/tools/index.ts")>();
  const createStudioMcpServer: typeof tools.createStudioMcpServer = (context) => {
    mcpServersBuilt.count += 1;
    return tools.createStudioMcpServer(context);
  };
  return { ...tools, createStudioMcpServer };
});
afterEach(() => {
  mcpServersBuilt.count = 0;
});

const APP_PORT = 4317;
const REPORT_FILE = "claude-p-report.json";
const isWindows = process.platform === "win32";

// Stands in for `claude -p`: records the twin's URL and token in its cwd, then waits on stdin like a real run.
const PRINT_CLAUDE_SOURCE = `#!/usr/bin/env node
import { renameSync, writeFileSync } from "node:fs";
writeFileSync("report.tmp", JSON.stringify({ mcpUrl: process.env.ZKS_MCP_URL, mcpToken: process.env.ZKS_MCP_TOKEN, hookToken: process.env.ZKS_HOOK_TOKEN }));
renameSync("report.tmp", ${JSON.stringify(REPORT_FILE)});
process.stdin.resume();
`;

interface Harness {
  readonly server: TestServer;
  readonly services: AgentServices;
  readonly sdkCalls: string[];
  readonly submitPrompt: () => Promise<{ status: number; dir: string }>;
  readonly close: () => Promise<void>;
}

async function startHarness(hasSdkBinary: boolean): Promise<Harness> {
  const fakeDir = await mkdtemp(join(tmpdir(), "zks-print-claude-"));
  const claudePath = join(fakeDir, "claude");
  await writeFile(claudePath, PRINT_CLAUDE_SOURCE);
  await chmod(claudePath, 0o755);
  const sdkCalls: string[] = [];
  const sdkQuery: QueryFunction = ({ projectId }) => {
    sdkCalls.push(projectId);
    return (async function* () {})();
  };
  const security = createSecurity({ appPort: APP_PORT, previewPort: 4318, container: false });
  let services: AgentServices | undefined;
  const server = await createTestServer((base) => {
    services = createAgentServices({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      jobRunner: base.jobRunner,
      logger: base.logger,
      appPort: APP_PORT,
      appVersion: "0.0.0-test",
      pluginDir: join(base.scratchDir, "plugin"),
      runDir: join(base.studioHome, "run"),
      claudePath,
      claudeVersion: "2.1.300",
      secretStore: createSecretStore({
        studioHome: base.studioHome,
        platform: "linux",
        keyring: memoryKeyring("test-key-0000abcd"),
        readMounts: () => Promise.resolve(""),
      }),
      query: sdkQuery,
      hasSdkBinary: () => hasSdkBinary,
      engine: { run: () => Promise.reject(new Error("engine not installed in tests")) },
    });
    return { security, agent: services };
  });
  if (services === undefined) throw new Error("createTestServer did not build the agent services");
  await writeConnection(server.database.db, { mode: "api_key", keyLast4: "abcd" });

  const submitPrompt = async () => {
    const project = await insertProject(server);
    const dir = projectDir(server.studioHome, project.slug);
    await mkdir(dir, { recursive: true });
    const response = await server.app.request(
      API_ROUTES.submitPrompt.path.replace(":projectId", project.id),
      {
        method: "POST",
        headers: { host: TEST_HOST, origin: `http://${TEST_HOST}`, [CSRF_HEADER]: security.csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      },
      connectionFrom("127.0.0.1"),
    );
    return { status: response.status, dir };
  };
  const finalServices = services;
  return {
    server,
    services: finalServices,
    sdkCalls,
    submitPrompt,
    close: async () => {
      finalServices.shutdown();
      await server.close();
      await rm(fakeDir, { recursive: true, force: true });
    },
  };
}

describe("agent services with the SDK's claude binary installed", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await startHarness(true);
  });
  afterAll(() => harness.close());

  it("runs sessions through the SDK query", async () => {
    expect(harness.services.agentRunner).toBe("sdk");
    expect((await harness.submitPrompt()).status).toBe(200);
    expect(harness.sdkCalls).toHaveLength(1);
    expect(mcpServersBuilt.count).toBe(1);
  });
});

describe.skipIf(isWindows)("agent services without the SDK's claude binary", () => {
  let harness: Harness;
  beforeAll(async () => {
    harness = await startHarness(false);
  });
  afterAll(() => harness.close());

  const twinTools = (sessionId: string, token: string) =>
    harness.server.app.request(`/api/mcp/${sessionId}/tools`, { headers: { host: TEST_HOST, authorization: `Bearer ${token}` } }, connectionFrom("127.0.0.1"));

  it("falls back to claude -p, whose twin calls are admitted while unknown sessions are refused", async () => {
    expect(harness.services.agentRunner).toBe("print");
    const { status, dir } = await harness.submitPrompt();
    expect(status).toBe(200);

    const reportPath = join(dir, REPORT_FILE);
    await waitFor(() => existsSync(reportPath));
    const report = JSON.parse(await readFile(reportPath, "utf8")) as { mcpUrl: string; mcpToken: string; hookToken: string };
    const sessionId = decodeURIComponent(report.mcpUrl.split("/").at(-1) ?? "");

    expect(harness.sdkCalls).toEqual([]);
    expect(mcpServersBuilt.count).toBe(0);
    expect((await twinTools(sessionId, report.mcpToken)).status).toBe(200);
    expect((await twinTools(randomUUID(), report.mcpToken)).status).toBe(401);

    const hook = await harness.server.app.request(
      API_ROUTES.terminalHooks.path.replace(":sessionId", sessionId),
      {
        method: "POST",
        headers: { host: TEST_HOST, authorization: `Bearer ${report.hookToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          hook_event_name: "PreToolUse",
          tool_name: "Read",
          tool_input: { file_path: "/etc/hostname" },
          tool_use_id: "toolu_1",
        }),
      },
      connectionFrom("127.0.0.1"),
    );
    expect(await hook.json()).toMatchObject({ hookSpecificOutput: { permissionDecision: "deny" } });
  });
});
