// Created by The Angelo Umali.
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { deliverables } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "../../src/config.ts";
import { createTestServer, connectionFrom, getRequest, insertProject, postJson, TEST_HOST, type TestServer } from "../support/test-server.ts";

const openedFolders: string[] = [];
let server: TestServer;
beforeAll(async () => {
  server = await createTestServer({ openFolder: (folderPath: string) => void openedFolders.push(folderPath) });
});
afterAll(async () => {
  await server.close();
});

const SHA_OF_EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("deliverable routes", () => {
  it("lists a project's deliverables", async () => {
    const project = await insertProject(server);
    await server.database.db
      .insert(deliverables)
      .values({ projectId: project.id, kind: "full", relPath: `deliverables/${project.slug}-4k.mp4`, bytes: 0, sha256: SHA_OF_EMPTY });

    const response = await getRequest(server, `/api/projects/${project.id}/deliverables`);

    expect(response.status).toBe(200);
    const body = API_ROUTES.listDeliverables.response.parse(await response.json());
    expect(body.deliverables).toMatchObject([{ kind: "full", name: `${project.slug}-4k.mp4`, bytes: 0, sha256: SHA_OF_EMPTY }]);
  });

  it("opens the project's deliverables folder for a browser on this computer", async () => {
    const project = await insertProject(server);

    const response = await postJson(server, `/api/projects/${project.id}/reveal`, { path: "/etc" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    const deliverablesDir = join(projectDir(server.studioHome, project.slug), "deliverables");
    expect(openedFolders.at(-1)).toBe(deliverablesDir);
    expect((await stat(deliverablesDir)).isDirectory()).toBe(true);
  });

  it("refuses a reveal from another computer", async () => {
    const project = await insertProject(server);
    const openedBefore = openedFolders.length;

    const response = await server.app.request(
      `/api/projects/${project.id}/reveal`,
      { method: "POST", headers: { host: TEST_HOST } },
      connectionFrom("10.0.0.5"),
    );

    expect(response.status).toBe(403);
    expect(openedFolders).toHaveLength(openedBefore);
  });

  it("answers 404 for an unknown project", async () => {
    const response = await postJson(server, "/api/projects/00000000-0000-4000-8000-00000000dead/reveal", null);
    expect(response.status).toBe(404);
  });
});
