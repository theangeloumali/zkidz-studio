// Created by The Angelo Umali.
import { jobs } from "@zks/db/schema";
import { JobSchema, type StudioEvent } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobRunner } from "../src/jobs/job-runner.ts";
import { createLogger } from "../src/logging/logger.ts";
import { createTestServer, getRequest, insertProject, type TestServer } from "./support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

function recordEvents(projectId: string): StudioEvent[] {
  const received: StudioEvent[] = [];
  server.eventBus.subscribe([projectId], (event) => received.push(event));
  return received;
}

function newRunner(now: () => number = Date.now) {
  return new JobRunner({ database: server.database.db, eventBus: server.eventBus, logger: createLogger(() => undefined), now });
}

describe("JobRunner", () => {
  it("runs a queued job to succeeded, publishing queued → started → progress → finished", async () => {
    const project = await insertProject(server);
    const received = recordEvents(project.id);
    const runner = newRunner();
    runner.registerHandler("probe", async (_job, reportProgress) => {
      await reportProgress({ stage: "probing", pct: 100 });
    });
    const job = await runner.enqueue({ projectId: project.id, kind: "probe", videoId: "v1", lane: "cpu" });
    await runner.idle();

    expect(received.map((event) => event.type)).toEqual(["job.queued", "job.started", "job.progress", "job.finished"]);
    expect(received.at(-1)).toMatchObject({ jobId: job.id, kind: "probe", status: "succeeded" });
    const [row] = await server.database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row).toMatchObject({ status: "succeeded", stage: "probing", pct: 100 });
    expect(row?.finishedAt).toBeInstanceOf(Date);
  });

  it("persists and publishes progress at most once a second, but always at 100%", async () => {
    const project = await insertProject(server);
    const received = recordEvents(project.id);
    let clockMs = 0;
    const runner = newRunner(() => clockMs);
    runner.registerHandler("render", async (_job, reportProgress) => {
      await reportProgress({ stage: "encode", pct: 10 });
      clockMs += 400;
      await reportProgress({ stage: "encode", pct: 20 });
      clockMs += 700;
      await reportProgress({ stage: "encode", pct: 30, etaS: 5 });
      clockMs += 10;
      await reportProgress({ stage: "encode", pct: 100 });
    });
    await runner.enqueue({ projectId: project.id, kind: "render", videoId: "v1", lane: "gpu" });
    await runner.idle();
    const progressPercents = received.flatMap((event) => (event.type === "job.progress" ? [event.pct] : []));
    expect(progressPercents).toEqual([10, 30, 100]);
  });

  it("fails a throwing job with a redacted, stack-free error", async () => {
    const project = await insertProject(server);
    const runner = newRunner();
    runner.registerHandler("boom", () => Promise.reject(new Error("bad key sk-ant-api03-abcdefghijklmnop for a@b.co")));
    const job = await runner.enqueue({ projectId: project.id, kind: "boom", videoId: "v1", lane: "cpu" });
    await runner.idle();
    const [row] = await server.database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe("failed");
    expect(row?.error).not.toMatch(/sk-ant-api03|a@b\.co|\n\s+at /);
  });

  it("fails a job whose kind has no handler", async () => {
    const project = await insertProject(server);
    const runner = newRunner();
    const job = await runner.enqueue({ projectId: project.id, kind: "unknown-kind", videoId: "v1", lane: "cpu" });
    await runner.idle();
    const [row] = await server.database.db.select().from(jobs).where(eq(jobs.id, job.id));
    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("unknown-kind");
  });

  it("runs one job per lane at a time, in queue order, while other lanes proceed", async () => {
    const project = await insertProject(server);
    const runner = newRunner();
    const timeline: string[] = [];
    let releaseFirst = () => undefined as void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    runner.registerHandler("slow", async (job) => {
      timeline.push(`start ${String(job.params["name"])}`);
      if (job.params["name"] === "gpu-1") await firstBlocked;
      timeline.push(`end ${String(job.params["name"])}`);
    });
    await runner.enqueue({ projectId: project.id, kind: "slow", videoId: "v1", lane: "gpu", params: { name: "gpu-1" } });
    await runner.enqueue({ projectId: project.id, kind: "slow", videoId: "v1", lane: "gpu", params: { name: "gpu-2" } });
    await runner.enqueue({ projectId: project.id, kind: "slow", videoId: "v1", lane: "cpu", params: { name: "cpu-1" } });
    await expect.poll(() => timeline.includes("end cpu-1")).toBe(true);
    expect(timeline).not.toContain("start gpu-2");
    releaseFirst();
    await runner.idle();
    expect(timeline.indexOf("start gpu-2")).toBeGreaterThan(timeline.indexOf("end gpu-1"));
  });

  it("cancels one project's queued jobs on stop, leaving its running job and other projects alone", async () => {
    const stopped = await insertProject(server);
    const other = await insertProject(server);
    const received = recordEvents(stopped.id);
    const runner = newRunner();
    const ran: string[] = [];
    let releaseRunning = () => undefined as void;
    const runningBlocked = new Promise<void>((resolve) => {
      releaseRunning = resolve;
    });
    runner.registerHandler("slow", async (job) => {
      ran.push(String(job.params["name"]));
      if (job.params["name"] === "running") await runningBlocked;
    });
    const running = await runner.enqueue({ projectId: stopped.id, kind: "slow", videoId: "v1", lane: "gpu", params: { name: "running" } });
    await expect.poll(() => ran.includes("running")).toBe(true);
    const queued = await runner.enqueue({ projectId: stopped.id, kind: "slow", videoId: "v1", lane: "gpu", params: { name: "queued" } });
    await runner.enqueue({ projectId: other.id, kind: "slow", videoId: "v1", lane: "gpu", params: { name: "other" } });

    expect(await runner.cancelQueued(stopped.id)).toBe(1);
    releaseRunning();
    await runner.idle();

    expect(ran).toEqual(["running", "other"]);
    const statusOf = async (id: string) => (await server.database.db.select().from(jobs).where(eq(jobs.id, id)))[0]?.status;
    expect(await statusOf(queued.id)).toBe("cancelled");
    expect(await statusOf(running.id)).toBe("succeeded");
    expect(received).toContainEqual(expect.objectContaining({ type: "job.finished", jobId: queued.id, status: "cancelled" }));
  });

  it("marks jobs left running by a dead server as interrupted", async () => {
    const project = await insertProject(server);
    const [stale] = await server.database.db
      .insert(jobs)
      .values({ projectId: project.id, kind: "render", videoId: "v1", lane: "gpu", status: "running" })
      .returning();
    expect(await newRunner().recoverInterrupted()).toBeGreaterThanOrEqual(1);
    const [row] = await server.database.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, stale?.id ?? ""));
    expect(row?.status).toBe("interrupted");
  });
});

describe("GET /api/projects/:projectId/jobs", () => {
  it("lists the project's jobs as contract DTOs", async () => {
    const project = await insertProject(server);
    const runner = newRunner();
    runner.registerHandler("noop", () => Promise.resolve());
    const job = await runner.enqueue({ projectId: project.id, kind: "noop", videoId: "v1", lane: "cpu" });
    await runner.idle();
    const listing = (await (await getRequest(server, `/api/projects/${project.id}/jobs`)).json()) as { jobs: unknown[] };
    expect(listing.jobs.map((entry) => JobSchema.parse(entry))).toMatchObject([{ id: job.id, status: "succeeded" }]);
  });

  it("answers 404 for an unknown project", async () => {
    expect((await getRequest(server, `/api/projects/${crypto.randomUUID()}/jobs`)).status).toBe(404);
  });
});
