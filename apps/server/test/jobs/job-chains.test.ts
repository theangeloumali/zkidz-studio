// Created by The Angelo Umali.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";
import { newRunner, readJob, startedSignal } from "./job-test-kit.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("JobRunner dependency chains", () => {
  it("runs a dependent only after its dependency succeeds, even on another lane", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const runOrder: string[] = [];
    runner.registerHandler("render", async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      runOrder.push("render");
    });
    runner.registerHandler("export", () => {
      runOrder.push("export");
      return Promise.resolve();
    });
    const render = await runner.enqueue({ projectId: project.id, kind: "render", videoId: "v1", lane: "gpu" });
    const exportJob = await runner.enqueue({ projectId: project.id, kind: "export", videoId: "v1", lane: "cpu", dependsOn: [render.id] });
    await runner.idle();

    expect(runOrder).toEqual(["render", "export"]);
    expect((await readJob(server, exportJob.id)).dependsOn).toEqual([render.id]);
    expect((await readJob(server, exportJob.id)).status).toBe("succeeded");
  });

  it("cancels every queued job downstream of a failed dependency", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    runner.registerHandler("render", () => Promise.reject(new Error("encoder crashed")));
    runner.registerHandler("covers", () => Promise.resolve());
    const render = await runner.enqueue({ projectId: project.id, kind: "render", videoId: "v1", lane: "gpu" });
    const covers = await runner.enqueue({ projectId: project.id, kind: "covers", videoId: "v1", lane: "gpu", dependsOn: [render.id] });
    const exportJob = await runner.enqueue({ projectId: project.id, kind: "covers", videoId: "v1", lane: "cpu", dependsOn: [covers.id] });
    await runner.idle();

    expect((await readJob(server, covers.id)).status).toBe("cancelled");
    const exportRow = await readJob(server, exportJob.id);
    expect(exportRow.status).toBe("cancelled");
    expect(exportRow.error).toMatch(/depends on/);
  });

  it("cancels a job enqueued behind a dependency that has already failed", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    runner.registerHandler("render", () => Promise.reject(new Error("no frames")));
    const render = await runner.enqueue({ projectId: project.id, kind: "render", videoId: "v1", lane: "gpu" });
    await runner.idle();
    const lateExport = await runner.enqueue({ projectId: project.id, kind: "export", videoId: "v1", lane: "cpu", dependsOn: [render.id] });
    await runner.idle();
    expect((await readJob(server, lateExport.id)).status).toBe("cancelled");
  });

  it("refuses a dependency on another project's job", async () => {
    const project = await insertProject(server);
    const otherProject = await insertProject(server);
    const runner = newRunner(server);
    runner.registerHandler("render", () => Promise.resolve());
    const foreignJob = await runner.enqueue({ projectId: otherProject.id, kind: "render", videoId: "v1", lane: "gpu" });
    await expect(runner.enqueue({ projectId: project.id, kind: "render", videoId: "v1", lane: "cpu", dependsOn: [foreignJob.id] })).rejects.toThrow(
      /not a job of this project/,
    );
    await runner.idle();
  });
});

describe("JobRunner lanes", () => {
  it("runs the gpu, cpu and whisper lanes side by side", async () => {
    const project = await insertProject(server);
    const runner = newRunner(server);
    const lanesRunning = new Set<string>();
    let peakConcurrentLanes = 0;
    const allStarted = startedSignal();
    for (const lane of ["gpu", "cpu", "whisper"] as const) {
      runner.registerHandler(`work-${lane}`, async () => {
        lanesRunning.add(lane);
        peakConcurrentLanes = Math.max(peakConcurrentLanes, lanesRunning.size);
        if (lanesRunning.size === 3) allStarted.markStarted();
        await allStarted.hasStarted;
        lanesRunning.delete(lane);
      });
      await runner.enqueue({ projectId: project.id, kind: `work-${lane}`, videoId: "v1", lane });
    }
    await runner.idle();
    expect(peakConcurrentLanes).toBe(3);
  });
});
