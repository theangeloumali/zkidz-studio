// Created by The Angelo Umali.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { awaitCutReview } from "../../src/tools/cut-review.ts";
import { createTestServer, insertProject, postJson, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

function postDecision(projectId: string, requestId: string, body: unknown) {
  return postJson(server, `/api/projects/${projectId}/cut-candidates/${requestId}`, body);
}

describe("POST /api/projects/:projectId/cut-candidates/:requestId", () => {
  it("is a 404 for an unknown requestId", async () => {
    const project = await insertProject(server);
    const response = await postDecision(project.id, "no-such-request", { approved: [], rejected: [] });
    expect(response.status).toBe(404);
  });

  it("resolves the pending propose_cuts review with the approved ids", async () => {
    const project = await insertProject(server);
    const review = awaitCutReview({
      projectId: project.id,
      requestId: "review-1",
      candidates: [
        { id: "c1", at: 1, end: 2 },
        { id: "c2", at: 3, end: 4 },
      ],
    });

    const response = await postDecision(project.id, "review-1", { approved: ["c1"], rejected: ["c2"] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    await expect(review).resolves.toEqual({ approved: ["c1"], rejected: ["c2"] });
  });

  it("is a 404 when the review belongs to another project", async () => {
    const owner = await insertProject(server);
    const intruder = await insertProject(server);
    const review = awaitCutReview({ projectId: owner.id, requestId: "review-2", candidates: [{ id: "c1", at: 1, end: 2 }] });

    const response = await postDecision(intruder.id, "review-2", { approved: ["c1"], rejected: [] });

    expect(response.status).toBe(404);
    await postDecision(owner.id, "review-2", { approved: [], rejected: ["c1"] });
    await expect(review).resolves.toEqual({ approved: [], rejected: ["c1"] });
  });

  it("is a 400 for a body that is not a decision", async () => {
    const project = await insertProject(server);
    const response = await postDecision(project.id, "review-3", { approved: "all" });
    expect(response.status).toBe(400);
  });
});
