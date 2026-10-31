// Created by The Angelo Umali.
// Drives the recorder with the events an agent and the job runner publish; no real agent runs.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { agentSessions, editSpecs, editSpecVersions, edits, jobs, projects } from "@zks/db/schema";
import type { StudioEvent, UsageFigures, UsageSource } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EditRecorder } from "../../src/edits/edit-recorder.ts";
import { EventBus } from "../../src/events/event-bus.ts";
import { EXPORT_JOB_KIND } from "../../src/jobs/deliverables.ts";
import { createLogger } from "../../src/logging/logger.ts";

let scratchDir = "";
let database: StudioDatabaseHandle;
let eventBus: EventBus;
let recorder: EditRecorder;
let projectId = "";
let published: StudioEvent[] = [];

async function startRecorder(): Promise<EditRecorder> {
  const started = new EditRecorder({ database: database.db, eventBus, logger: createLogger(() => undefined), persistIntervalMs: 10 });
  await started.start();
  return started;
}

beforeEach(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "zks-edits-"));
  database = await openDatabase({ dataDir: join(scratchDir, "db") });
  await database.migrate();
  eventBus = new EventBus(database.db);
  published = [];
  eventBus.subscribeAll((event) => published.push(event));
  const [project] = await database.db.insert(projects).values({ slug: "demo", title: "Demo trip" }).returning();
  projectId = project?.id ?? "";
  recorder = await startRecorder();
});

afterEach(async () => {
  await recorder.stop();
  await database.close();
  await rm(scratchDir, { recursive: true, force: true });
});

async function publish(event: Parameters<EventBus["publish"]>[0]): Promise<void> {
  await eventBus.publish(event);
  await recorder.idle();
}

const prompt = (text = "make the edit") => publish({ type: "prompt.submitted", projectId, text });
const sessionStarted = (sessionId: string) => publish({ type: "session.started", projectId, sessionId, model: "m", credential: "key", skills: [] });
const usage = (sessionId: string, source: UsageSource, figures: UsageFigures) => publish({ type: "usage.reported", projectId, sessionId, source, ...figures });
const turnCompleted = (costUsd?: number) =>
  publish({ type: "turn.completed", projectId, subtype: "success", isError: false, costUsd, numTurns: 1, durationMs: 1000 });

async function finishExport(status: "succeeded" | "failed" = "succeeded"): Promise<string> {
  const [job] = await database.db.insert(jobs).values({ projectId, kind: EXPORT_JOB_KIND, videoId: "v1", lane: "cpu", status }).returning();
  const jobId = job?.id ?? "";
  await publish({ type: "job.finished", projectId, jobId, kind: EXPORT_JOB_KIND, status });
  return jobId;
}

async function editRows() {
  return database.db.select().from(edits).where(eq(edits.projectId, projectId)).orderBy(edits.startedAt);
}

async function onlyEdit() {
  const rows = await editRows();
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (row === undefined) throw new Error("no edit row");
  return row;
}

describe("EditRecorder", () => {
  it("opens no edit for usage alone, then one on the first prompt", async () => {
    await usage("s1", "claude_statusline", { costUsd: 0.1 });
    expect(await editRows()).toEqual([]);

    await prompt();

    expect(await onlyEdit()).toMatchObject({ status: "open", videoId: "v1", agentKind: "claude", turns: 1 });
    const [project] = await database.db.select().from(projects).where(eq(projects.id, projectId));
    expect(project?.status).toBe("editing");
  });

  it("opens on an SDK tool call, since the SDK path publishes no prompt.submitted", async () => {
    await publish({ type: "tool.called", projectId, toolUseId: "t1", name: "mcp__studio__project_info", label: "project info", input: {} });

    expect(await onlyEdit()).toMatchObject({ status: "open" });
  });

  it("keeps each session's latest total, sums sessions and leaves out spend from before the edit", async () => {
    await usage("s1", "claude_statusline", { costUsd: 0.25 });
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.5, durationMs: 60_000 });
    await usage("s1", "claude_statusline", { costUsd: 0.75 });
    await usage("s1", "claude_transcript", { inputTokens: 1000, outputTokens: 200, cacheTokens: 5000 });
    await usage("s1", "claude_transcript", { inputTokens: 1500, outputTokens: 300, cacheTokens: 9000 });
    await usage("s2", "claude_statusline", { costUsd: 0.1 });
    await recorder.flush();

    expect(await onlyEdit()).toMatchObject({ costUsd: "0.600000", costSource: "claude_statusline", inputTokens: 1500, outputTokens: 300, cacheTokens: 9000 });
  });

  it("never counts one session twice when two sources report the same total", async () => {
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.4 });
    await usage("s1", "sdk", { costUsd: 0.4 });
    await recorder.flush();

    expect((await onlyEdit()).costUsd).toBe("0.400000");
  });

  it("counts SDK turn costs as the current session's sdk total, after the spend a resumed session already had", async () => {
    await database.db.insert(agentSessions).values({ projectId, sdkSessionId: "resumed", authMode: "api_key", totalCostUsd: "1.5" });
    await sessionStarted("resumed");
    await publish({ type: "tool.called", projectId, toolUseId: "t1", name: "mcp__studio__project_info", label: "project info", input: {} });
    await turnCompleted(1.75);
    await sessionStarted("resumed");
    await turnCompleted(2);
    await recorder.flush();

    expect(await onlyEdit()).toMatchObject({ costUsd: "0.500000", costSource: "sdk", turns: 2 });
  });

  it("saves the cost of an SDK turn that opened the edit itself, with no tool call before it", async () => {
    await sessionStarted("text-only");
    await turnCompleted(0.4);

    await expect.poll(async () => (await editRows())[0]?.costUsd).toBe("0.400000");
  });

  it("leaves cost empty for a sign-in plan that reports only tokens", async () => {
    await prompt();
    await usage("s1", "claude_transcript", { inputTokens: 10, outputTokens: 5 });
    await recorder.flush();

    expect(await onlyEdit()).toMatchObject({ costUsd: null, costSource: null, inputTokens: 10, outputTokens: 5 });
  });

  it("writes running totals within the persist interval, without an explicit flush", async () => {
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.3 });

    await expect.poll(async () => (await onlyEdit()).costUsd).toBe("0.300000");
  });

  it("closes on a successful export with the edit's facts and publishes edit.closed", async () => {
    const [spec] = await database.db
      .insert(editSpecs)
      .values({ projectId, videoId: "v1", kind: "cuts", relPath: "work/cuts/v1.json", currentVersion: 1 })
      .returning();
    const cuts = {
      schemaVersion: 1,
      sourceAssetId: crypto.randomUUID(),
      durationS: 100,
      fps: { num: 30, den: 1 },
      removals: [
        { at: 10, end: 20, reason: "retake" },
        { at: 50, end: 60, reason: "filler" },
        { at: 70, end: 75, reason: "retake" },
      ],
    };
    await database.db.insert(editSpecVersions).values({ specId: spec?.id ?? "", version: 1, sha256: "a", content: JSON.stringify(cuts), author: "agent" });
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.62 });
    await recorder.recordAnswers(projectId, { "Which opening should we polish?": "The flat tyre", "Music?": "None" });

    await finishExport("failed");
    expect((await onlyEdit()).status).toBe("open");
    const exportJobId = await finishExport();

    const closed = await onlyEdit();
    expect(closed).toMatchObject({ status: "closed", exportJobId, costUsd: "0.620000" });
    expect(closed.finishedAt).toBeInstanceOf(Date);
    expect(closed.facts).toEqual({
      sourceS: 100,
      keptS: 75,
      segments: 4,
      cutReasons: ["retake", "filler"],
      opening: "The flat tyre",
      answers: { "Which opening should we polish?": "The flat tyre", "Music?": "None" },
    });
    const [project] = await database.db.select().from(projects).where(eq(projects.id, projectId));
    expect(project?.status).toBe("delivered");
    expect(published.filter((event) => event.type === "edit.closed")).toMatchObject([{ editId: closed.id, costUsd: 0.62 }]);
  });

  it("opens a second edit on the next prompt, not on the export turn's tail, and counts only new spend", async () => {
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.5 });
    await finishExport();
    await publish({ type: "tool.called", projectId, toolUseId: "t2", name: "mcp__studio__suggest_lessons", label: "suggest lessons", input: {} });
    await usage("s1", "claude_statusline", { costUsd: 0.55 });
    expect(await editRows()).toHaveLength(1);

    await prompt("another cut");
    await usage("s1", "claude_statusline", { costUsd: 0.8 });
    await recorder.flush();

    const rows = await editRows();
    expect(rows.map((row) => [row.status, row.costUsd])).toEqual([
      ["closed", "0.500000"],
      ["open", "0.250000"],
    ]);
  });

  // A query on a closed PGlite never returns and blocks the event loop, so nothing may run once stop() settles.
  it("finishes its queued work on stop and runs nothing after, from events or its save timer", async () => {
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.3 });
    await recorder.stop();
    const rowsAtStop = await database.db.select().from(edits);

    await eventBus.publish({ type: "prompt.submitted", projectId, text: "late" });
    await eventBus.publish({ type: "usage.reported", projectId, sessionId: "s1", source: "claude_statusline", costUsd: 0.9 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await database.db.select().from(edits)).toEqual(rowsAtStop);
    expect(rowsAtStop.map((row) => row.costUsd)).toEqual(["0.300000"]);
  });

  it("keeps an open edit's totals across a restart without counting a session's earlier spend again", async () => {
    await prompt();
    await usage("s1", "claude_statusline", { costUsd: 0.4 });
    await recorder.recordAnswers(projectId, { "Music?": "Lo-fi" });
    await recorder.flush();
    await recorder.stop();

    recorder = await startRecorder();
    await usage("s1", "claude_statusline", { costUsd: 0.45 });
    await usage("s1", "claude_statusline", { costUsd: 0.6 });
    await prompt("next");
    await recorder.flush();

    expect(await onlyEdit()).toMatchObject({ status: "open", costUsd: "0.550000", turns: 2, facts: { cutReasons: [], answers: { "Music?": "Lo-fi" } } });
  });

  it("survives the project being deleted mid-edit", async () => {
    await prompt();
    await database.db.delete(projects).where(eq(projects.id, projectId));
    await recorder.flush();

    expect(await editRows()).toEqual([]);
  });
});
