// Created by The Angelo Umali.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { agentSessions, projects } from "@zks/db/schema";
import type { StudioEvent } from "@zks/shared";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { DISALLOWED_TOOLS } from "../../src/agent/init-assertion.ts";
import { AgentManager } from "../../src/agent/manager.ts";
import { registerAgentRoutes } from "../../src/agent/routes.ts";
import { writeConnection } from "../../src/auth/connection-store.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { toHttpError } from "../../src/http/http-error.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { memoryKeyring } from "../auth/memory-keyring.ts";
import { initMessage, REQUIRED_SKILLS, resultMessage, SDK_SESSION_ID } from "./sdk-fixtures.ts";
import { ScriptedQuery, settle } from "./scripted-query.ts";

const API_KEY = "test-key-0000abcd";

describe("agent routes", () => {
  let scratchDir = "";
  let database: StudioDatabaseHandle;
  let scripted: ScriptedQuery;
  let published: NewStudioEvent[];
  let cancelledJobs: string[];
  let manager: AgentManager;
  let app: Hono;
  let projectId = "";

  function buildApp(): Hono {
    const publish = (event: NewStudioEvent) => {
      published.push(event);
      return Promise.resolve({ ...event, at: new Date().toISOString() } as StudioEvent);
    };
    manager = new AgentManager({
      database: database.db,
      secretStore: createSecretStore({ studioHome: scratchDir, platform: "linux", keyring: memoryKeyring(API_KEY), readMounts: () => Promise.resolve("") }),
      logger: createLogger(() => undefined),
      studioHome: scratchDir,
      appVersion: "0.0.0-test",
      pluginDir: join(scratchDir, "plugin"),
      requiredSkills: REQUIRED_SKILLS,
      query: scripted.query,
      broker: new DecisionBroker({ publish }),
      limits: { maxTurns: 8, maxBudgetUsd: 2 },
      studioMcpServer: () => ({ type: "stdio", command: "studio-mcp" }),
      cancelProjectJobs: (id) => {
        cancelledJobs.push(id);
        return Promise.resolve();
      },
    });
    const server = new Hono();
    registerAgentRoutes(server, { database: database.db, manager });
    server.onError((error, c) => {
      const httpError = toHttpError(error);
      return c.json({ error: httpError.message }, httpError.status);
    });
    return server;
  }

  const post = (path: string, body: unknown = null) =>
    app.request(`/api/projects/${projectId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const options = (index = 0): Options => {
    const call = scripted.calls[index];
    if (call === undefined) throw new Error(`no query call ${index}`);
    return call;
  };
  const sessionRows = () => database.db.select().from(agentSessions);

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-agent-"));
    database = await openDatabase({ dataDir: join(scratchDir, "db") });
    await database.migrate();
    await writeConnection(database.db, { mode: "api_key", keyLast4: "abcd" });
    scripted = new ScriptedQuery();
    published = [];
    cancelledJobs = [];
    const [project] = await database.db.insert(projects).values({ slug: "p1", title: "p1" }).returning();
    projectId = project?.id ?? "";
    app = buildApp();
  });

  afterEach(async () => {
    manager.closeAll();
    await settle();
    await database.close();
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("refuses a prompt with 409 until Claude is connected", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    expect((await post("prompt", { text: "Make a cut" })).status).toBe(409);
    expect(scripted.calls).toHaveLength(0);
  });

  it("answers 404 for an unknown project and 400 for an empty prompt", async () => {
    const unknown = await app.request(`/api/projects/${crypto.randomUUID()}/prompt`, { method: "POST", body: '{"text":"x"}' });
    expect(unknown.status).toBe(404);
    expect((await post("prompt", { text: "  " })).status).toBe(400);
  });

  it("starts one locked-down session per project and reuses it for the next prompt", async () => {
    expect((await post("prompt", { text: "Make a cut" })).status).toBe(200);
    expect(await (await post("prompt", { text: "Shorter" })).json()).toEqual({ ok: true });
    await settle();

    expect(scripted.calls).toHaveLength(1);
    expect(scripted.prompts).toEqual(["Make a cut", "Shorter"]);
    expect(options()).toMatchObject({
      cwd: join(scratchDir, "projects", "p1"),
      settingSources: [],
      plugins: [{ type: "local", path: join(scratchDir, "plugin") }],
      tools: ["Read", "Skill", "AskUserQuestion"],
      disallowedTools: [...DISALLOWED_TOOLS],
      strictMcpConfig: true,
      permissionMode: "default",
      includePartialMessages: true,
      maxTurns: 8,
      maxBudgetUsd: 2,
    });
    expect(options().env).toMatchObject({ ANTHROPIC_API_KEY: API_KEY, CLAUDE_CONFIG_DIR: join(scratchDir, "agent-config") });
    expect(Object.keys(options().mcpServers ?? {})).toEqual(["studio"]);
    expect(options().resume).toBeUndefined();
  });

  it("records the SDK session on init and its latest turn count and cost on result", async () => {
    await post("prompt", { text: "Make a cut" });
    scripted.emit(initMessage());
    scripted.emit(resultMessage({ num_turns: 3, total_cost_usd: 0.25 }));
    await vi.waitFor(async () => expect((await sessionRows())[0]?.status).toBe("idle"));

    const [row] = await sessionRows();
    expect(row).toMatchObject({ projectId, sdkSessionId: SDK_SESSION_ID, authMode: "api_key", status: "idle", numTurns: 3, totalCostUsd: "0.250000" });
    const [project] = await database.db.select().from(projects).where(eq(projects.id, projectId));
    expect(project?.currentSessionId).toBe(row?.id);
  });

  it("resumes the stored SDK session after a restart", async () => {
    await post("prompt", { text: "Make a cut" });
    scripted.emit(initMessage());
    await vi.waitFor(async () => expect(await sessionRows()).toHaveLength(1));

    manager.closeAll();
    app = buildApp();
    await post("prompt", { text: "Again" });
    expect(options(1).resume).toBe(SDK_SESSION_ID);
    expect(await sessionRows()).toHaveLength(1);
  });

  it("never resumes a mode T session, which lives in the user's own config dir", async () => {
    const [terminalRow] = await database.db
      .insert(agentSessions)
      .values({ projectId, sdkSessionId: crypto.randomUUID(), authMode: "terminal" })
      .returning({ id: agentSessions.id });
    await database.db.update(projects).set({ currentSessionId: terminalRow?.id }).where(eq(projects.id, projectId));

    await post("prompt", { text: "Make a cut" });
    expect(options().resume).toBeUndefined();
  });

  it("settles a pending approval through decisions and 404s a stale one", async () => {
    await post("prompt", { text: "Render" });
    scripted.emit(initMessage());
    await settle();
    const context = { signal: new AbortController().signal, toolUseID: "t", requestId: "r" };
    const pending = options().canUseTool?.("mcp__studio__render_master", { target: "full", quality: "4k" }, context);
    await settle();
    const card = published.find((event) => event.type === "approval.requested");
    const requestId = card?.type === "approval.requested" ? card.requestId : "";

    expect((await post("decisions", { kind: "approval", requestId: crypto.randomUUID(), decision: "allow" })).status).toBe(404);
    expect((await post("decisions", { kind: "approval", requestId, decision: "allow" })).status).toBe(200);
    expect(await pending).toMatchObject({ behavior: "allow" });
  });

  it("stop interrupts and cancels jobs; kill closes, marks the row interrupted and the next prompt resumes", async () => {
    await post("prompt", { text: "Make a cut" });
    scripted.emit(initMessage());
    await settle();

    expect((await post("stop")).status).toBe(200);
    expect(scripted.interrupts).toBe(1);
    expect(cancelledJobs).toEqual([projectId]);

    expect((await post("kill")).status).toBe(200);
    expect(scripted.closes).toBe(1);
    await vi.waitFor(async () => expect((await sessionRows())[0]?.status).toBe("interrupted"));
    await post("prompt", { text: "Back again" });
    expect(options(1).resume).toBe(SDK_SESSION_ID);
  });

  it("stop with no live session still cancels the project's jobs", async () => {
    expect((await post("stop")).status).toBe(200);
    expect(cancelledJobs).toEqual([projectId]);
    expect(scripted.calls).toHaveLength(0);
  });

  it("auto-resumes once after a crash, then shows the error and marks the row errored", async () => {
    await post("prompt", { text: "Make a cut" });
    scripted.emit(initMessage());
    scripted.fail(new Error("child exited"));
    await vi.waitFor(() => expect(scripted.calls).toHaveLength(2));
    expect(options(1).resume).toBe(SDK_SESSION_ID);

    scripted.emit(initMessage());
    scripted.fail(new Error("child exited again"));
    await vi.waitFor(() => expect(published.at(-1)).toMatchObject({ type: "session.error", kind: "unknown" }));
    expect(scripted.calls).toHaveLength(2);
    await vi.waitFor(async () => expect((await sessionRows())[0]?.status).toBe("errored"));
  });

  it("closeAll ends every live session so a changed connection takes effect on the next prompt", async () => {
    await post("prompt", { text: "Make a cut" });
    scripted.emit(initMessage());
    await settle();
    manager.closeAll();
    await post("prompt", { text: "Next" });
    expect(scripted.closes).toBe(1);
    expect(scripted.calls).toHaveLength(2);
  });
});
