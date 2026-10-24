// Created by The Angelo Umali.
import { jobs } from "@zks/db/schema";
import type { StudioEvent } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobHandler } from "../../src/jobs/job-runner.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";
import { newRunner, readJob, startedSignal } from "./job-test-kit.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

/** A render that runs until its signal aborts, as an engine process does when it is killed. */
function renderUntilAborted(markStarted: () => void): JobHandler {
  return (_job, _reportProgress, signal) =>
    new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("engine killed")), { once: true });
      markStarted();
    });
}

describe("JobRunner cancel and resume", () => {
  it("leaves a running job interrupted and resumable when it is cancelled mid-render", async () => {
    const project = await insertProject(server);
    const received: StudioEvent[] = [];
    server.eventBus.subscribe([project.id], (event) => received.push(event));
    const runner = newRunner(server);
    const render = startedSignal();
    runner.registerHandler("render_master", renderUntilAborted(render.markStarted));
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await render.hasStarted;

    const cancelled = await runner.cancel(job.id);

    expect(cancelled.status).toBe("interrupted");
    expect(await readJob(server, job.id)).toMatchObject({ status: "interrupted", error: "Cancelled by the user" });
    expect(received.at(-1)).toMatchObject({ type: "job.finished", jobId: job.id, status: "interrupted" });
  });

  it("leaves the job interrupted when its handler ignores the abort and resolves anyway", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const render = startedSignal();
    runner.registerHandler("render_master", (_job, _reportProgress, signal) => {
      render.markStarted();
      return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    });
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await render.hasStarted;

    expect((await runner.cancel(job.id)).status).toBe("interrupted");
  });

  it("resumes an interrupted job as a new attempt that runs to success", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const render = startedSignal();
    let attemptsSeen: number[] = [];
    runner.registerHandler("render_master", renderUntilAborted(render.markStarted));
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await render.hasStarted;
    await runner.cancel(job.id);

    runner.registerHandler("render_master", (resumedJob) => {
      attemptsSeen = [...attemptsSeen, resumedJob.attempt];
      return Promise.resolve();
    });
    const resumed = await runner.resume(job.id);
    await runner.idle();

    expect(resumed.status).toBe("queued");
    expect(attemptsSeen).toEqual([1]);
    expect(await readJob(server, job.id)).toMatchObject({ status: "succeeded", attempt: 1, error: null });
  });

  it("holds a dependent queued while its dependency is interrupted, then runs it after the resume", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const render = startedSignal();
    runner.registerHandler("render_master", renderUntilAborted(render.markStarted));
    runner.registerHandler("export_deliverable", () => Promise.resolve());
    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    const exportJob = await runner.enqueue({ projectId: project.id, kind: "export_deliverable", videoId: "v1", lane: "cpu", dependsOn: [job.id] });
    await render.hasStarted;
    await runner.cancel(job.id);
    await runner.idle();
    expect((await readJob(server, exportJob.id)).status).toBe("queued");

    runner.registerHandler("render_master", () => Promise.resolve());
    await runner.resume(job.id);
    await runner.idle();
    expect((await readJob(server, exportJob.id)).status).toBe("succeeded");
  });

  it("cancels a queued job outright", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const blocker = startedSignal();
    runner.registerHandler("render_master", renderUntilAborted(blocker.markStarted));
    const running = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    const queued = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1r", lane: "gpu" });
    await blocker.hasStarted;

    expect((await runner.cancel(queued.id)).status).toBe("cancelled");
    await runner.cancel(running.id);
    await runner.idle();
  });

  it("refuses to resume a job that is not interrupted", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    runner.registerHandler("probe", () => Promise.resolve());
    const job = await runner.enqueue({ projectId: project.id, kind: "probe", videoId: "v1", lane: "cpu" });
    await runner.idle();
    await expect(runner.resume(job.id)).rejects.toThrow(/only an interrupted job/);
  });
});

describe("JobRunner boot recovery", () => {
  it("turns a dead server's running row into an interrupted job that resumes", async () => {
    const project = await insertProject(server);
    const [staleRow] = await server.database.db
      .insert(jobs)
      .values({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu", status: "running", startedAt: new Date() })
      .returning();
    if (staleRow === undefined) throw new Error("insert returned no row");

    const bootRunner = newRunner(server);
    expect(await bootRunner.recoverInterrupted()).toBeGreaterThanOrEqual(1);
    expect((await readJob(server, staleRow.id)).status).toBe("interrupted");

    bootRunner.registerHandler("render_master", () => Promise.resolve());
    await bootRunner.resume(staleRow.id);
    await bootRunner.idle();
    const [finished] = await server.database.db.select().from(jobs).where(eq(jobs.id, staleRow.id));
    expect(finished).toMatchObject({ status: "succeeded", attempt: 1 });
  });
});
