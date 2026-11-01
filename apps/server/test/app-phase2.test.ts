// Created by The Angelo Umali.
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, CSRF_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createAgentServices, type AgentServices } from "../src/agent-services.ts";
import { writeConnection } from "../src/auth/connection-store.ts";
import { createSecretStore } from "../src/auth/secret-store.ts";
import { projectDir } from "../src/config.ts";
import { createSecurity } from "../src/security/index.ts";
import { awaitCutReview, holdCutReviewCard, resolveCutReview } from "../src/tools/cut-review.ts";
import type { EngineRequest } from "../src/tools/engine-jobs.ts";
import { memoryKeyring } from "./auth/memory-keyring.ts";
import { readJob } from "./jobs/job-test-kit.ts";
import { openSseReader } from "./support/sse-reader.ts";
import { connectionFrom, createTestServer, getRequest, insertProject, TEST_HOST, type TestServer, type TestServerBase } from "./support/test-server.ts";
import { writeStubClaude } from "./terminal/stub-claude.ts";

const APP_PORT = 4317;
const ORIGIN = `http://${TEST_HOST}`;
const CLAUDE_VERSION = "2.1.300";
const isWindows = process.platform === "win32";

let server: TestServer;
let services: AgentServices;
let csrfToken = "";
let stubDir = "";
const engineRequests: EngineRequest[] = [];

function servicesFor(base: TestServerBase, claudePath: string | null): AgentServices {
  return createAgentServices({
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
    claudeVersion: CLAUDE_VERSION,
    secretStore: createSecretStore({ studioHome: base.studioHome, platform: "linux", keyring: memoryKeyring(), readMounts: () => Promise.resolve("") }),
    query: () => {
      throw new Error("no SDK session is started in these tests");
    },
    // Pinned so the runner never depends on which optional SDK binary this machine installed.
    hasSdkBinary: () => true,
    ffprobePath: "ffprobe",
    engine: {
      run: (request) => {
        engineRequests.push(request);
        return Promise.reject(new Error("engine not installed in tests"));
      },
    },
  });
}

beforeAll(async () => {
  stubDir = await mkdtemp(join(tmpdir(), "zks-app-claude-"));
  const claudePath = isWindows ? null : await writeStubClaude(stubDir);
  const security = createSecurity({ appPort: APP_PORT, previewPort: 4318, container: false });
  csrfToken = security.csrfToken;
  server = await createTestServer((base) => {
    services = servicesFor(base, claudePath);
    return { security, agent: services };
  });
});
afterAll(async () => {
  await services.shutdown();
  await server.close();
  await rm(stubDir, { recursive: true, force: true });
});

const send = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
  server.app.request(path, { method: init.method ?? "GET", headers: { host: TEST_HOST, ...init.headers }, body: init.body }, connectionFrom("127.0.0.1"));
const browserPost = (path: string) => send(path, { method: "POST", headers: { origin: ORIGIN, [CSRF_HEADER]: csrfToken, "content-type": "application/json" } });
const projectPath = (path: string, projectId: string) => path.replace(":projectId", projectId);

describe("createApp with the Phase 2 services", () => {
  it("runs agent sessions through the SDK", async () => {
    expect(await services.agentRunner).toBe("sdk");
  });

  it("serves the connect screen with the resolved claude version", async () => {
    const response = await send(API_ROUTES.getConnection.path);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ claudeVersion: CLAUDE_VERSION });
  });

  it("mounts the hooks bridge and the MCP twin behind their bearer checks", async () => {
    const sessionId = randomUUID();
    const hookPath = API_ROUTES.terminalHooks.path.replace(":sessionId", sessionId);
    const hook = JSON.stringify({ session_id: sessionId, hook_event_name: "Stop" });

    const hookResponse = await send(hookPath, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer wrong" }, body: hook });
    const mcpResponse = await send(`/api/mcp/${sessionId}/tools`, { headers: { authorization: "Bearer wrong" } });
    expect(hookResponse.status).toBe(401);
    expect(mcpResponse.status).toBe(401);
  });

  it("mounts the agent panel routes", async () => {
    const project = await insertProject(server);
    expect((await browserPost(projectPath(API_ROUTES.stopTurn.path, project.id))).status).toBe(200);
  });

  it("refuses to open a terminal outside terminal mode", async () => {
    const project = await insertProject(server);
    expect((await browserPost(projectPath(API_ROUTES.openTerminal.path, project.id))).status).toBe(409);
  });

  it("sends a new event stream the cut review still waiting on the user", async () => {
    const project = await insertProject(server);
    const requestId = randomUUID();
    const candidates = [{ id: "c1", kind: "filler" as const, at: 1, end: 1.4, context: "um", reason: "filler word" }];
    const review = awaitCutReview({ projectId: project.id, requestId, candidates });
    const card = await server.eventBus.publish({ type: "cuts.proposed", projectId: project.id, requestId, candidates });
    holdCutReviewCard(card);

    const sse = await openSseReader(await getRequest(server, `/api/events?project=${project.id}`));
    const [frame] = await sse.nextFrames(1);
    await sse.close();
    resolveCutReview(project.id, requestId, { approved: [], rejected: ["c1"] });
    await review;
    expect(frame).toEqual({ id: undefined, data: card });
  });

  it("runs engine jobs through the registered handlers", async () => {
    const project = await insertProject(server);
    await server.jobRunner.enqueue({ projectId: project.id, kind: "transcribe", videoId: "v1", lane: "cpu", params: { language: "en", model: "base" } });
    await server.jobRunner.idle();
    expect(engineRequests.map((request) => request.command)).toEqual(["transcribe"]);
  });

  it("runs export_deliverable through the registered export handler", async () => {
    const project = await insertProject(server);
    const job = await server.jobRunner.enqueue({ projectId: project.id, kind: "export_deliverable", videoId: "v1", lane: "cpu", params: { kinds: ["full"] } });
    await server.jobRunner.idle();
    // Export asks the engine's QC gate first; this stub engine refuses, so nothing is copied.
    expect(engineRequests.at(-1)).toMatchObject({ command: "qc-status", args: ["--video", "v1"] });
    expect((await readJob(server, job.id)).error).toMatch(/^v1 has not passed QC: engine not installed in tests/);
  });

  const openProjectTerminal = async () => {
    const project = await insertProject(server);
    await mkdir(projectDir(server.studioHome, project.slug), { recursive: true });
    await writeConnection(server.database.db, { mode: "terminal" });
    const { sessionId } = (await (await browserPost(projectPath(API_ROUTES.openTerminal.path, project.id))).json()) as { sessionId: string };
    const session = services.terminalSessions.find(sessionId);
    if (session === undefined) throw new Error("the opened terminal is not tracked");
    return { project, session };
  };

  it.skipIf(isWindows)(
    "closes the open terminal when the connection changes, so the next open runs the newly connected agent",
    { timeout: 30_000 },
    async () => {
      const { project, session } = await openProjectTerminal();
      const exited = new Promise<void>((resolve) => session.pty.onExit(() => resolve()));

      const connected = await send(API_ROUTES.connectTerminal.path, {
        method: "POST",
        headers: { origin: ORIGIN, [CSRF_HEADER]: csrfToken, "content-type": "application/json" },
        body: JSON.stringify({ hasAcceptedDisclosure: true }),
      });

      expect(connected.status).toBe(200);
      await exited;
      expect(services.terminalSessions.findByProject(project.id)).toBeUndefined();
    },
  );

  it.skipIf(isWindows)("dismisses a question card when Claude Code drops the hook request", { timeout: 30_000 }, async () => {
    const { project, session } = await openProjectTerminal();
    const hookPath = API_ROUTES.terminalHooks.path.replace(":sessionId", session.sessionId);
    const question = {
      session_id: session.sessionId,
      hook_event_name: "PreToolUse",
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [{ question: "Which opening?", header: "Opening", multiSelect: false, options: [{ label: "The pop", description: "Start on it" }] }],
      },
    };
    const dropped = new AbortController();
    const held = server.app.request(
      hookPath,
      {
        method: "POST",
        headers: { host: TEST_HOST, authorization: `Bearer ${session.hookToken}`, "content-type": "application/json" },
        body: JSON.stringify(question),
        signal: dropped.signal,
      },
      connectionFrom("127.0.0.1"),
    );
    await vi.waitFor(() => expect(services.pendingCards([project.id])).not.toEqual([]), { timeout: 10_000 });

    dropped.abort();

    await vi.waitFor(() => expect(services.pendingCards([project.id])).toEqual([]), { timeout: 10_000 });
    await Promise.resolve(held).catch(() => undefined);
    services.terminalSessions.kill(project.id);
  });

  it.skipIf(isWindows)("opens a terminal in terminal mode, and shutdown kills it", async () => {
    const project = await insertProject(server);
    await mkdir(projectDir(server.studioHome, project.slug), { recursive: true });
    await writeConnection(server.database.db, { mode: "terminal" });

    const response = await browserPost(projectPath(API_ROUTES.openTerminal.path, project.id));
    expect(response.status).toBe(200);
    const { sessionId } = (await response.json()) as { sessionId: string };
    const session = services.terminalSessions.find(sessionId);
    if (session === undefined) throw new Error("the opened terminal is not tracked");
    const exited = new Promise<void>((resolve) => session.pty.onExit(() => resolve()));
    await services.shutdown();
    await exited;
  });
});
