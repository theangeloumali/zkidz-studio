// Created by The Angelo Umali.
// Replays recorded SDK sessions (FakeAgent) to prove a user's rule reaches the next session, and agent output never does.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { agentSessions, projects, rules } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { AgentManager } from "../../src/agent/manager.ts";
import { registerAgentRoutes } from "../../src/agent/routes.ts";
import { writeConnection } from "../../src/auth/connection-store.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { toHttpError } from "../../src/http/http-error.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { registerRuleRoutes } from "../../src/rules/routes.ts";
import { RULES_BLOCK_OPEN } from "../../src/rules/rules-prompt.ts";
import { loadSessionSetup } from "../../src/rules/session-setup.ts";
import { createFakeAgent, type FakeAgent } from "../agent-harness/fake-agent.ts";
import { REQUIRED_SKILLS } from "../agent/sdk-fixtures.ts";
import { memoryKeyring } from "../auth/memory-keyring.ts";

describe("rules reach the next replayed session", () => {
  let scratchDir = "";
  let database: StudioDatabaseHandle;
  let fakeAgent: FakeAgent;
  let manager: AgentManager;
  let app: Hono;
  let projectId = "";

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-rules-"));
    database = await openDatabase({ dataDir: join(scratchDir, "db") });
    await database.migrate();
    // Cloud mode: the recorded init reports apiKeySource "none", so the replay passes the init assertion.
    await writeConnection(database.db, { mode: "cloud", provider: "bedrock", values: { AWS_REGION: "us-east-1" } });
    const [project] = await database.db.insert(projects).values({ slug: "demo", title: "demo" }).returning();
    projectId = project?.id ?? "";
    fakeAgent = createFakeAgent("init-text-result", "init-text-result");
    manager = new AgentManager({
      database: database.db,
      secretStore: createSecretStore({ studioHome: scratchDir, platform: "linux", keyring: memoryKeyring(), readMounts: () => Promise.resolve("") }),
      logger: createLogger(() => undefined),
      studioHome: scratchDir,
      appVersion: "0.0.0-test",
      pluginDir: join(scratchDir, "plugin"),
      requiredSkills: REQUIRED_SKILLS,
      query: fakeAgent.query,
      broker: new DecisionBroker({ publish: (event: NewStudioEvent) => Promise.resolve({ ...event, at: new Date().toISOString() }) }),
      limits: { maxTurns: 8, maxBudgetUsd: 2 },
      loadSessionSetup: (row) => loadSessionSetup(database.db, row.id),
      studioMcpServer: () => ({ type: "stdio", command: "studio-mcp" }),
      cancelProjectJobs: () => Promise.resolve(),
    });
    app = new Hono();
    registerAgentRoutes(app, { database: database.db, manager });
    registerRuleRoutes(app, { database: database.db });
    app.onError((error, c) => {
      const httpError = toHttpError(error);
      return c.json({ error: httpError.message }, httpError.status);
    });
  });

  afterEach(async () => {
    manager.closeAll();
    // Closing PGlite under the kill's pending status write hangs the worker.
    await vi.waitFor(async () => {
      const rows = await database.db.select({ status: agentSessions.status }).from(agentSessions);
      expect(rows.every((row) => row.status === "interrupted")).toBe(true);
    });
    await database.close();
    await rm(scratchDir, { recursive: true, force: true });
  });

  const send = (method: "POST" | "PUT", path: string, body: unknown = null) =>
    app.request(path.replace(":projectId", projectId), { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const optionsOf = (callIndex: number): Options => {
    const call = fakeAgent.calls[callIndex];
    if (call === undefined) throw new Error(`no query call ${callIndex}`);
    return call.options;
  };
  async function runReplayedTurn(text: string, callCount: number): Promise<void> {
    expect((await send("POST", API_ROUTES.submitPrompt.path, { text })).status).toBe(200);
    await vi.waitFor(async () => {
      expect(fakeAgent.calls).toHaveLength(callCount);
      expect((await database.db.select().from(agentSessions)).at(-1)?.status).toBe("idle");
    });
  }

  it("appends a rule the user creates to the next session's system prompt, inside the delimited block", async () => {
    await runReplayedTurn("Make a cut", 1);
    const firstPrompt = optionsOf(0).systemPrompt;
    const firstAppend = typeof firstPrompt === "object" && !Array.isArray(firstPrompt) && firstPrompt.type === "preset" ? firstPrompt.append : undefined;
    // The default house style applies before any rule exists.
    expect(firstAppend).toContain("Style preset (ZKidz)");
    expect(firstAppend).not.toContain("\n- ");
    // The replayed agent finished a whole turn; nothing it said became a rule.
    expect(await database.db.select().from(rules)).toEqual([]);

    expect((await send("POST", API_ROUTES.createRule.path, { text: "Keep cuts under 60 s" })).status).toBe(201);
    expect((await send("PUT", API_ROUTES.updateProjectSettings.path, { maxTurns: 12 })).status).toBe(200);
    expect((await send("POST", API_ROUTES.killSession.path)).status).toBe(200);
    await runReplayedTurn("Shorter", 2);

    const nextPrompt = optionsOf(1).systemPrompt;
    expect(nextPrompt).toMatchObject({ type: "preset", preset: "claude_code", snapshot: false });
    const appended = typeof nextPrompt === "object" && !Array.isArray(nextPrompt) && nextPrompt.type === "preset" ? nextPrompt.append : undefined;
    expect(appended?.startsWith(RULES_BLOCK_OPEN)).toBe(true);
    expect(appended).toContain("- Keep cuts under 60 s");
    expect(optionsOf(1).maxTurns).toBe(12);
    // Cloud billing has no SDK budget cap.
    expect(optionsOf(1).maxBudgetUsd).toBeUndefined();
  });
});
