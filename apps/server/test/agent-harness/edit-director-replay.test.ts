// Created by The Angelo Umali.
// Replays a recorded edit-director turn through the session manager: the feed shows three rough openings before any polish,
// then an entertainment review after the preview (plan §6.9, Phase 6 AC).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { agentSessions, projects } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { AgentManager } from "../../src/agent/manager.ts";
import { registerAgentRoutes } from "../../src/agent/routes.ts";
import { writeConnection } from "../../src/auth/connection-store.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { REQUIRED_SKILLS, stubGateFacts } from "../agent/sdk-fixtures.ts";
import { memoryKeyring } from "../auth/memory-keyring.ts";
import { createFakeAgent } from "./fake-agent.ts";

/** Tools that dress or finish the edit; the skill allows none of them before the openings are compared. */
const POLISH_TOOLS = new Set(["set_cuts", "add_cue", "update_cue", "set_captions", "set_reel", "render_preview"].map((name) => `mcp__studio__${name}`));

type FeedItem = { readonly kind: "text"; readonly text: string } | { readonly kind: "tool"; readonly name: string };

/** Joins consecutive text deltas into one feed item, as the web feed renders them. */
function toFeed(events: readonly NewStudioEvent[]): FeedItem[] {
  const feed: FeedItem[] = [];
  for (const event of events) {
    const last = feed.at(-1);
    if (event.type === "text.delta") {
      if (last?.kind === "text") feed[feed.length - 1] = { kind: "text", text: last.text + event.text };
      else feed.push({ kind: "text", text: event.text });
    } else if (event.type === "tool.called") {
      feed.push({ kind: "tool", name: event.name });
    }
  }
  return feed;
}

describe("edit-director replay", () => {
  let scratchDir = "";
  let database: StudioDatabaseHandle;
  let manager: AgentManager;
  let app: Hono;
  let projectId = "";
  const published: NewStudioEvent[] = [];

  beforeEach(async () => {
    published.length = 0;
    scratchDir = await mkdtemp(join(tmpdir(), "zks-director-"));
    database = await openDatabase({ dataDir: join(scratchDir, "db") });
    await database.migrate();
    // Cloud mode: the recorded init reports apiKeySource "none", so the replay passes the init assertion.
    await writeConnection(database.db, { mode: "cloud", provider: "bedrock", values: { AWS_REGION: "us-east-1" } });
    const [project] = await database.db.insert(projects).values({ slug: "demo", title: "demo" }).returning();
    projectId = project?.id ?? "";
    manager = new AgentManager({
      database: database.db,
      secretStore: createSecretStore({ studioHome: scratchDir, platform: "linux", keyring: memoryKeyring(), readMounts: () => Promise.resolve("") }),
      logger: createLogger(() => undefined),
      studioHome: scratchDir,
      appVersion: "0.0.0-test",
      pluginDir: join(scratchDir, "plugin"),
      requiredSkills: REQUIRED_SKILLS,
      query: createFakeAgent("edit-director-openings").query,
      broker: new DecisionBroker({
        publish: (event: NewStudioEvent) => {
          published.push(event);
          return Promise.resolve({ ...event, at: new Date().toISOString() });
        },
      }),
      limits: { maxTurns: 8, maxBudgetUsd: 2 },
      studioMcpServer: () => ({ type: "stdio", command: "studio-mcp" }),
      describeGate: (_project, tool) => stubGateFacts(tool),
      cancelProjectJobs: () => Promise.resolve(),
    });
    app = new Hono();
    registerAgentRoutes(app, { database: database.db, manager });
  });

  afterEach(async () => {
    manager.closeAll();
    // Closing PGlite under a pending status write hangs the worker. The replay ends on its own, so the session stays idle.
    await vi.waitFor(async () => {
      const rows = await database.db.select({ status: agentSessions.status }).from(agentSessions);
      expect(rows.every((row) => row.status === "idle" || row.status === "interrupted")).toBe(true);
    });
    await database.close();
    await rm(scratchDir, { recursive: true, force: true });
  });

  it("shows three rough openings compared before polish, and an entertainment review after the preview", async () => {
    const response = await app.request(API_ROUTES.submitPrompt.path.replace(":projectId", projectId), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "Edit this into a short and pick the opening yourself" }),
    });
    expect(response.status).toBe(200);
    // Idle, not just turn.completed: the teardown's kill must not race the turn's own status write.
    await vi.waitFor(async () => {
      expect(published.some((event) => event.type === "turn.completed")).toBe(true);
      expect((await database.db.select().from(agentSessions)).at(-1)?.status).toBe("idle");
    });

    const feed = toFeed(published);
    const firstPolish = feed.findIndex((item) => item.kind === "tool" && POLISH_TOOLS.has(item.name));
    const preview = feed.findIndex((item) => item.kind === "tool" && item.name === "mcp__studio__render_preview");
    const textBeforePolish = feed
      .slice(0, firstPolish)
      .flatMap((item) => (item.kind === "text" ? [item.text] : []))
      .join("\n");
    const review = feed.slice(preview + 1).find((item) => item.kind === "text" && item.text.startsWith("Entertainment review"));

    expect(firstPolish).toBeGreaterThan(0);
    expect(textBeforePolish.match(/^Opening \d/gm)).toEqual(["Opening 1", "Opening 2", "Opening 3"]);
    expect(textBeforePolish).toMatch(/^Opening 3[\s\S]+^Comparing the three openings.+I recommend opening \d/m);
    expect(preview).toBeGreaterThan(firstPolish);
    // Timestamped beats in edited time; a dip names its cause and fix.
    expect(review?.kind === "text" ? review.text : "").toMatch(/0:00–0:03 .+\n0:03–0:08 .+dip.+fix/s);
  });
});
