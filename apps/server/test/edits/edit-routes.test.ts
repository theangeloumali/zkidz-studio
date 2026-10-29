// Created by The Angelo Umali.
import { edits } from "@zks/db/schema";
import { API_ROUTES, type EditSummary } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestServer, getRequest, insertProject, postJson, type TestServer } from "../support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  // Stands in for the agent routes: the decide route accepts every decision.
  server = await createTestServer({ agent: { registerRoutes: (app) => app.post(API_ROUTES.decide.path, (c) => c.json({ ok: true })) } });
});
afterAll(async () => {
  await server.close();
});

const editsPath = (projectId: string) => API_ROUTES.listEdits.path.replace(":projectId", projectId);

async function readEdits(path: string): Promise<EditSummary[]> {
  const response = await getRequest(server, path);
  expect(response.status).toBe(200);
  return API_ROUTES.listEdits.response.parse(await response.json()).edits;
}

describe("edit routes", () => {
  it("opens an edit from the app's own recorder and lists it with numeric totals", async () => {
    const project = await insertProject(server);
    await server.eventBus.publish({ type: "prompt.submitted", projectId: project.id, text: "go" });

    await expect.poll(async () => (await readEdits(editsPath(project.id))).length).toBe(1);
    const [edit] = await readEdits(editsPath(project.id));
    expect(edit).toMatchObject({ projectId: project.id, status: "open", turns: 1, costUsd: null, finishedAt: null, facts: null });
  });

  it("reads the open edit's running totals as of the last event, not the last throttled write", async () => {
    const project = await insertProject(server);
    await server.eventBus.publish({ type: "prompt.submitted", projectId: project.id, text: "go" });
    await server.eventBus.publish({ type: "usage.reported", projectId: project.id, sessionId: "s1", source: "claude_statusline", inputTokens: 900 });

    const [edit] = await readEdits(editsPath(project.id));
    expect(edit).toMatchObject({ status: "open", inputTokens: 900 });
  });

  it("lists a project's edits newest first and each project's newest edit on the home list", async () => {
    const [first, second] = [await insertProject(server), await insertProject(server)];
    await server.database.db.insert(edits).values([
      { projectId: first.id, videoId: "v1", agentKind: "claude", status: "closed", startedAt: new Date("2026-10-01T10:00:00Z"), costUsd: "0.620000" },
      { projectId: first.id, videoId: "v1", agentKind: "claude", startedAt: new Date("2026-10-02T10:00:00Z") },
      { projectId: second.id, videoId: "v1", agentKind: "codex", status: "closed", startedAt: new Date("2026-10-03T10:00:00Z"), inputTokens: 42 },
    ]);

    const projectEdits = await readEdits(editsPath(first.id));
    expect(projectEdits.map((edit) => edit.startedAt)).toEqual(["2026-10-02T10:00:00.000Z", "2026-10-01T10:00:00.000Z"]);
    expect(projectEdits[1]?.costUsd).toBe(0.62);

    const latest = (await readEdits(API_ROUTES.latestEdits.path)).filter((edit) => [first.id, second.id].includes(edit.projectId));
    expect(latest.map((edit) => [edit.projectId, edit.startedAt, edit.inputTokens])).toEqual([
      [second.id, "2026-10-03T10:00:00.000Z", 42],
      [first.id, "2026-10-02T10:00:00.000Z", null],
    ]);
  });

  it("keeps the answers the decide route accepted as the edit's answers", async () => {
    const project = await insertProject(server);
    await server.eventBus.publish({ type: "prompt.submitted", projectId: project.id, text: "go" });
    await expect.poll(async () => (await readEdits(editsPath(project.id))).length).toBe(1);

    const decidePath = API_ROUTES.decide.path.replace(":projectId", project.id);
    const response = await postJson(server, decidePath, { kind: "question", requestId: "r1", answers: { "Which hook?": "Hook B" } });
    expect(response.status).toBe(200);

    await expect.poll(async () => (await readEdits(editsPath(project.id)))[0]?.facts?.answers).toEqual({ "Which hook?": "Hook B" });
  });

  it("is a 404 for a project that does not exist", async () => {
    const response = await getRequest(server, editsPath(crypto.randomUUID()));
    expect(response.status).toBe(404);
  });
});
