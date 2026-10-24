// Created by The Angelo Umali.
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JobRunner } from "../../src/jobs/job-runner.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";
import { readJob } from "./job-test-kit.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

describe("JobRunner error text", () => {
  it("stores a failed job's error with ZKS_HOME and user folders masked", async () => {
    const project = await insertProject(server);
    const runner = new JobRunner({
      database: server.database.db,
      eventBus: server.eventBus,
      logger: createLogger(() => undefined),
      studioHome: server.studioHome,
    });
    runner.registerHandler("render_master", () =>
      Promise.reject(new Error(`cannot open ${join(server.studioHome, "projects", "demo", "work", "out", "v1.mp4")} from /home/someone/engine`)),
    );

    const job = await runner.enqueue({ projectId: project.id, kind: "render_master", videoId: "v1", lane: "gpu" });
    await runner.idle();

    const { error } = await readJob(server, job.id);
    expect(error).toBe(`cannot open ${join("$ZKS_HOME", "projects", "demo", "work", "out", "v1.mp4")} from /home/<user>/engine`);
  });
});
