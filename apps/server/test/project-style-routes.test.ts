// Created by The Angelo Umali.
// GET and PUT /api/projects/:projectId/style, the routes the Style panel reads and writes (slice D).
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { mediaAssets } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "../src/config.ts";
import { connectionFrom, createTestServer, getRequest, insertProject, TEST_HOST, type TestServer } from "./support/test-server.ts";

let server: TestServer;
beforeAll(async () => {
  server = await createTestServer();
});
afterAll(async () => {
  await server.close();
});

function stylePath(projectId: string) {
  return API_ROUTES.getProjectStyle.path.replace(":projectId", projectId);
}

function putStyle(projectId: string, body: unknown) {
  const init = { method: "PUT", headers: { host: TEST_HOST, "content-type": "application/json" }, body: JSON.stringify(body) };
  return server.app.request(stylePath(projectId), init, connectionFrom("127.0.0.1"));
}

async function readStyle(projectId: string): Promise<unknown> {
  const response = await getRequest(server, stylePath(projectId));
  expect(response.status).toBe(200);
  return response.json();
}

async function insertReference(projectId: string) {
  const [asset] = await server.database.db
    .insert(mediaAssets)
    .values({ projectId, kind: "reference", name: "look.mp4", relPath: "media/raw/look.mp4", bytes: 1, mtimeMs: 0, durationS: 4 })
    .returning();
  if (asset === undefined) throw new Error("reference insert returned no row");
  return asset;
}

describe("project style routes", () => {
  it("answers a null style for a project that never set one", async () => {
    const project = await insertProject(server);
    expect(await readStyle(project.id)).toEqual({ style: null });
  });

  it("stores a style, reads it back and writes the renderer's file", async () => {
    const project = await insertProject(server);
    const style = { theme: "minimal", tokens: { ink: "#101820" }, type: { body: "Newsreader" }, sfx: "none" };
    const response = await putStyle(project.id, { style });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ style });
    expect(await readStyle(project.id)).toEqual({ style });
    const file = join(projectDir(server.studioHome, project.slug), "work", "style.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ theme: "minimal", tokens: { ink: "#101820" }, type: { body: "Newsreader" } });
  });

  it("switches back to no style: the column clears and the renderer's file goes", async () => {
    const project = await insertProject(server);
    await putStyle(project.id, { style: { theme: "zkidz", boil: false } });
    expect((await putStyle(project.id, { style: null })).status).toBe(200);
    expect(await readStyle(project.id)).toEqual({ style: null });
    await expect(access(join(projectDir(server.studioHome, project.slug), "work", "style.json"))).rejects.toThrow();
  });

  it("refuses a face the renderer does not bundle", async () => {
    const project = await insertProject(server);
    expect((await putStyle(project.id, { style: { theme: "zkidz", type: { body: "Comic Sans MS" } } })).status).toBe(400);
    expect(await readStyle(project.id)).toEqual({ style: null });
  });

  it("answers 404 for a project that does not exist", async () => {
    expect((await putStyle(crypto.randomUUID(), { style: null })).status).toBe(404);
    expect((await getRequest(server, stylePath(crypto.randomUUID()))).status).toBe(404);
  });

  it("forgets the reference once its asset is deleted and keeps the rest of the look", async () => {
    const project = await insertProject(server);
    const reference = await insertReference(project.id);
    await putStyle(project.id, { style: { theme: "zkidz", tokens: { gold: "#ff3366" }, referenceAssetId: reference.id } });
    await server.database.db.delete(mediaAssets).where(eq(mediaAssets.id, reference.id));
    expect(await readStyle(project.id)).toEqual({ style: { theme: "zkidz", tokens: { gold: "#ff3366" } } });
  });
});
