// Created by The Angelo Umali.
import { deliverables, edits, jobs, projects } from "@zks/db/schema";
import { API_ROUTES, PROJECT_STATUSES, type Stats } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestServer, getRequest, insertProject, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeEach(async () => {
  server = await createTestServer();
});
afterEach(async () => {
  await server.close();
});

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number, plusSeconds = 0) => new Date(Date.now() - days * DAY_MS + plusSeconds * 1000);

async function readStats(range?: string): Promise<Stats> {
  const response = await getRequest(server, range === undefined ? API_ROUTES.getStats.path : `${API_ROUTES.getStats.path}?range=${range}`);
  expect(response.status).toBe(200);
  return API_ROUTES.getStats.response.parse(await response.json());
}

/** A job queued at `queuedAt`, started `waitS` later and finished `runS` after that. */
async function insertFinishedJob(
  projectId: string,
  values: { kind: string; status: "succeeded" | "failed"; queuedAt: Date; waitS: number; runS: number; error?: string },
) {
  const startedAt = new Date(values.queuedAt.getTime() + values.waitS * 1000);
  const finishedAt = new Date(startedAt.getTime() + values.runS * 1000);
  const [job] = await server.database.db
    .insert(jobs)
    .values({
      projectId,
      kind: values.kind,
      videoId: "v1",
      lane: "gpu",
      status: values.status,
      queuedAt: values.queuedAt,
      startedAt,
      finishedAt,
      error: values.error ?? null,
    })
    .returning();
  return job ?? expect.fail("no job row");
}

describe("GET /api/stats", () => {
  it("answers an empty machine with zero counts, no medians and the empty-state flag", async () => {
    const stats = await readStats();

    expect(stats).toMatchObject({
      range: "30d",
      hasAnyEdit: false,
      jobsByWeek: [],
      medianRunS: null,
      medianQueueWaitS: null,
      failures: [],
      edits: [],
      deliverablesByWeek: [],
    });
    expect(stats.footage).toEqual({ keptS: 0, sourceS: 0 });
    expect(stats.projectsByStatus).toEqual(PROJECT_STATUSES.map((status) => ({ status, count: 0 })));
  });

  it("counts projects by their current status", async () => {
    const delivered = await insertProject(server);
    await insertProject(server);
    await server.database.db.update(projects).set({ status: "delivered" }).where(eq(projects.id, delivered.id));

    const { projectsByStatus } = await readStats();
    expect(projectsByStatus).toContainEqual({ status: "draft", count: 1 });
    expect(projectsByStatus).toContainEqual({ status: "delivered", count: 1 });
  });

  it("takes the median run time and queue wait over finished jobs", async () => {
    const project = await insertProject(server);
    await insertFinishedJob(project.id, { kind: "render_master", status: "succeeded", queuedAt: daysAgo(1), waitS: 2, runS: 30 });
    await insertFinishedJob(project.id, { kind: "render_master", status: "succeeded", queuedAt: daysAgo(1), waitS: 4, runS: 40 });
    await insertFinishedJob(project.id, {
      kind: "render_master",
      status: "failed",
      queuedAt: daysAgo(1),
      waitS: 10,
      runS: 90,
      error: "The encoder stopped at 62%.",
    });
    await insertFinishedJob(project.id, { kind: "qc_master", status: "succeeded", queuedAt: daysAgo(1), waitS: 6, runS: 50 });

    const stats = await readStats("7d");
    expect(stats.medianRunS).toBe(45);
    expect(stats.medianQueueWaitS).toBe(5);
    expect(stats.failures).toEqual([expect.objectContaining({ projectTitle: project.title, kind: "render_master", error: "The encoder stopped at 62%." })]);
    const renderRows = stats.jobsByWeek.filter((row) => row.kind === "render_master");
    expect(renderRows.map(({ outcome, count }) => ({ outcome, count }))).toEqual(
      expect.arrayContaining([
        { outcome: "succeeded", count: 2 },
        { outcome: "failed", count: 1 },
      ]),
    );
    expect(renderRows[0]?.week).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("leaves out jobs, edits and deliverables older than the range, and keeps them under all", async () => {
    const project = await insertProject(server);
    const oldJob = await insertFinishedJob(project.id, { kind: "export_deliverable", status: "succeeded", queuedAt: daysAgo(60), waitS: 1, runS: 3 });
    await server.database.db
      .insert(deliverables)
      .values({
        projectId: project.id,
        jobId: oldJob.id,
        kind: "full",
        relPath: "deliverables/old.mp4",
        bytes: 1,
        sha256: "a".repeat(64),
        createdAt: daysAgo(60),
      });
    await server.database.db.insert(edits).values({ projectId: project.id, videoId: "v1", agentKind: "claude_sdk", startedAt: daysAgo(60), turns: 2 });

    const recent = await readStats("7d");
    expect(recent).toMatchObject({ jobsByWeek: [], edits: [], deliverablesByWeek: [], hasAnyEdit: true });

    const everything = await readStats("all");
    expect(everything.jobsByWeek).toHaveLength(1);
    expect(everything.edits).toHaveLength(1);
    expect(everything.deliverablesByWeek).toEqual([expect.objectContaining({ count: 1 })]);
  });

  it("sums each edit's tokens and reads the footage it kept from its facts, never a cost", async () => {
    const project = await insertProject(server);
    await server.database.db.insert(edits).values({
      projectId: project.id,
      videoId: "v1",
      agentKind: "claude_sdk",
      status: "closed",
      startedAt: daysAgo(1),
      costUsd: "1.25",
      inputTokens: 1000,
      outputTokens: 200,
      cacheTokens: 50,
      turns: 9,
      facts: { sourceS: 200, keptS: 50, cutReasons: [], answers: {} },
    });
    await server.database.db.insert(edits).values({ projectId: project.id, videoId: "v1", agentKind: "claude_sdk", startedAt: daysAgo(2), turns: 1 });

    const stats = await readStats("7d");
    expect(stats.edits).toEqual([
      expect.objectContaining({ projectTitle: project.title, turns: 9, tokens: 1250, keptPct: 25 }),
      expect.objectContaining({ turns: 1, tokens: null, keptPct: null }),
    ]);
    expect(stats.footage).toEqual({ keptS: 50, sourceS: 200 });
    expect(JSON.stringify(stats)).not.toMatch(/cost|usd/i);
  });

  it("rejects a range it does not know", async () => {
    const response = await getRequest(server, `${API_ROUTES.getStats.path}?range=1y`);
    expect(response.status).toBe(400);
  });
});
