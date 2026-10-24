// Created by The Angelo Umali.
import { jobs } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJob } from "./job-test-kit.ts";
import { connectionFrom, createTestServer, insertProject, postJson, TEST_HOST, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

async function insertJob(projectId: string, status: "interrupted" | "succeeded") {
  const [job] = await server.database.db.insert(jobs).values({ projectId, kind: "unhandled", videoId: "v1", lane: "gpu", status, attempt: 1 }).returning();
  if (job === undefined) throw new Error("job insert returned no row");
  return job;
}

describe("job resume route", () => {
  it("requeues an interrupted job as its next attempt", async () => {
    const project = await insertProject(server);
    const job = await insertJob(project.id, "interrupted");

    const response = await postJson(server, `/api/projects/${project.id}/jobs/${job.id}/resume`, null);

    expect(response.status).toBe(200);
    const body = API_ROUTES.resumeJob.response.parse(await response.json());
    expect(body.job).toMatchObject({ id: job.id, status: "queued", error: null });
    expect((await readJob(server, job.id)).attempt).toBe(2);
  });

  it("refuses a job that is not interrupted", async () => {
    const project = await insertProject(server);
    const job = await insertJob(project.id, "succeeded");

    const response = await postJson(server, `/api/projects/${project.id}/jobs/${job.id}/resume`, null);

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Only an interrupted job can resume; this one is succeeded" });
  });

  it("answers 404 for another project's job", async () => {
    const owner = await insertProject(server);
    const other = await insertProject(server);
    const job = await insertJob(owner.id, "interrupted");

    const response = await postJson(server, `/api/projects/${other.id}/jobs/${job.id}/resume`, null);

    expect(response.status).toBe(404);
  });

  it("refuses a resume from another computer", async () => {
    const project = await insertProject(server);
    const job = await insertJob(project.id, "interrupted");
    const init = { method: "POST", headers: { host: TEST_HOST } };

    const response = await server.app.request(`/api/projects/${project.id}/jobs/${job.id}/resume`, init, connectionFrom("192.0.2.7"));

    expect(response.status).toBe(403);
  });
});
