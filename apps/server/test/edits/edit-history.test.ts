// Created by The Angelo Umali.
import { edits, projects } from "@zks/db/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDIT_HISTORY_BLOCK_OPEN } from "../../src/rules/rules-prompt.ts";
import { loadRulesPromptBlock } from "../../src/rules/session-setup.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

const day = (date: number) => new Date(`2026-10-${String(date).padStart(2, "0")}T10:00:00Z`);

describe("the edit history in a new session's prompt", () => {
  it("is left out until an edit has finished", async () => {
    const project = await insertProject(server);
    await server.database.db.insert(edits).values({ projectId: project.id, videoId: "v1", agentKind: "claude" });

    expect(await loadRulesPromptBlock(server.database.db)).not.toContain(EDIT_HISTORY_BLOCK_OPEN);
  });

  it("lists the five newest finished edits across projects, newest first", async () => {
    const [first, second] = [await insertProject(server), await insertProject(server)];
    await server.database.db.update(projects).set({ title: "Coast road" }).where(eq(projects.id, second.id));
    const finished = [1, 2, 3, 4, 5, 6].map((date) => ({
      projectId: date % 2 === 0 ? second.id : first.id,
      videoId: "v1",
      agentKind: "claude",
      status: "closed" as const,
      startedAt: day(date),
      finishedAt: new Date(day(date).getTime() + 5 * 60_000),
      inputTokens: 1000 * date,
    }));
    await server.database.db.insert(edits).values(finished);

    const block = await loadRulesPromptBlock(server.database.db);
    const lines = block
      .slice(block.indexOf(EDIT_HISTORY_BLOCK_OPEN))
      .split("\n")
      .filter((line) => line.startsWith("- "));

    expect(lines).toEqual([
      '- "Coast road", 2026-10-06: 5 min, 6k tokens',
      `- "${first.title}", 2026-10-05: 5 min, 5k tokens`,
      '- "Coast road", 2026-10-04: 5 min, 4k tokens',
      `- "${first.title}", 2026-10-03: 5 min, 3k tokens`,
      '- "Coast road", 2026-10-02: 5 min, 2k tokens',
    ]);
  });
});
