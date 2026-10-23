// Created by The Angelo Umali.
// The first drop on Home creates its project only once the clip is accepted, so a rejected drop leaves nothing behind.
import { mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projects } from "@zks/db/schema";
import { API_ROUTES, MediaAssetSchema, PROJECT_TITLE_HEADER, PROJECT_TITLE_MAX_CHARS, ProjectSchema, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { projectDir } from "../src/config.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../src/media-io/store.ts";
import { chunkedBody, hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";
import { connectionFrom, createTestServer, insertProject, postJson, TEST_HOST, type TestServer } from "./support/test-server.ts";

const ffmpegAvailable = await hasFfmpeg();
const SMALL_FILE_CAP = 64 * 1024;
const CreatedSchema = z.strictObject({ project: ProjectSchema, asset: MediaAssetSchema });
const OVERLONG_TITLE = "x".repeat(PROJECT_TITLE_MAX_CHARS + 1);

let server: TestServer;
let fixtures: MediaFixtures;
beforeAll(async () => {
  server = await createTestServer({ uploadLimits: { ...DEFAULT_UPLOAD_LIMITS, maxFileBytes: SMALL_FILE_CAP, maxProjectBytes: SMALL_FILE_CAP * 2 } });
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await server.close();
  if (ffmpegAvailable) await rm(fixtures.dir, { recursive: true, force: true });
});

function binaryPost(path: string, body: NonNullable<RequestInit["body"]>, headers: Record<string, string>) {
  const allHeaders = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: "first.mp4", ...headers };
  return server.app.request(path, { method: "POST", headers: allHeaders, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

function createWithMedia(body: NonNullable<RequestInit["body"]>, title: string | undefined, headers: Record<string, string> = {}) {
  const titleHeader: Record<string, string> = title === undefined ? {} : { [PROJECT_TITLE_HEADER]: title };
  return binaryPost(API_ROUTES.createProjectWithMedia.path, body, { ...titleHeader, ...headers });
}

/** Everything a rejected first upload could leave behind: project rows, project folders and .part files. */
async function studioFootprint() {
  const projectRows = await server.database.db.select({ id: projects.id }).from(projects);
  const projectFolders = await readdir(join(server.studioHome, "projects"));
  const partFiles = (await readdir(server.studioHome, { recursive: true })).filter((entry) => entry.endsWith(".part"));
  return { projectCount: projectRows.length, projectFolders: projectFolders.sort(), partFiles };
}

describe.skipIf(!ffmpegAvailable)("POST /api/projects/media", () => {
  it("creates the project and its first asset together", async () => {
    const response = await createWithMedia(await readFile(fixtures.clipMp4), encodeURIComponent("Día uno / take 2"));

    expect(response.status).toBe(201);
    const { project, asset } = CreatedSchema.parse(await response.json());
    expect(project.title).toBe("Día uno / take 2");
    expect(asset).toMatchObject({ projectId: project.id, name: "first.mp4", kind: "camera", isInPlace: false });
    expect(await readdir(join(projectDir(server.studioHome, project.slug), "media", "raw"))).toEqual([`${asset.id}.mp4`]);
    expect((await studioFootprint()).partFiles).toEqual([]);
  });

  it.each<[string, () => Promise<NonNullable<RequestInit["body"]>>, Record<string, string>]>([
    ["a playlist renamed to .mp4", () => readFile(fixtures.playlistAsMp4), {}],
    ["a declared Content-Length over the file cap", () => Promise.resolve(new Uint8Array(16)), { "content-length": String(SMALL_FILE_CAP + 1) }],
    ["a chunked body past the file cap", () => Promise.resolve(chunkedBody(new Uint8Array(SMALL_FILE_CAP * 2))), {}],
  ])("rejects %s exactly as uploadMedia does and creates nothing", async (_label, makeBody, headers) => {
    const existing = await insertProject(server);
    const uploadRejection = await binaryPost(`/api/projects/${existing.id}/media`, await makeBody(), headers);
    const before = await studioFootprint();

    const response = await createWithMedia(await makeBody(), encodeURIComponent("Rejected drop"), headers);

    expect(uploadRejection.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBe(uploadRejection.status);
    expect(await response.json()).toEqual(await uploadRejection.json());
    expect(await studioFootprint()).toEqual(before);
  });

  it.each([
    ["no title header", undefined],
    ["a blank title", encodeURIComponent("   ")],
    ["broken percent-encoding", "%E0%A4%A"],
    ["a title over the length cap", OVERLONG_TITLE],
  ])("answers 400 for %s and creates nothing", async (_label, title) => {
    const before = await studioFootprint();
    const response = await createWithMedia(await readFile(fixtures.clipMp4), title);
    expect(response.status).toBe(400);
    expect(await studioFootprint()).toEqual(before);
  });

  it("leaves no project, folder or .part when the client disconnects mid-stream", async () => {
    const before = await studioFootprint();
    let sentChunks = 0;
    const droppedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sentChunks++ < 3) controller.enqueue(new Uint8Array(4096));
        else controller.error(new Error("client went away"));
      },
    });

    const response = await createWithMedia(droppedBody, encodeURIComponent("Dropped connection"));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await studioFootprint()).toEqual(before);
  });
});

describe.skipIf(!ffmpegAvailable)("POST /api/projects/in-place", () => {
  const createInPlace = (body: unknown) => postJson(server, API_ROUTES.createProjectInPlace.path, body);

  it("creates the project and its in-place asset together, without copying the file", async () => {
    const response = await createInPlace({ title: "Día dos", path: fixtures.clipMp4 });

    expect(response.status).toBe(201);
    const { project, asset } = CreatedSchema.parse(await response.json());
    expect(project.title).toBe("Día dos");
    expect(asset).toMatchObject({ projectId: project.id, name: "clip.mp4", kind: "camera", isInPlace: true, bytes: (await stat(fixtures.clipMp4)).size });
    const projectFiles = await readdir(projectDir(server.studioHome, project.slug), { recursive: true });
    expect(projectFiles.filter((entry) => entry.endsWith(".mp4"))).toEqual([]);
  });

  it.each<[string, () => Promise<string>, number]>([
    ["a relative path", () => Promise.resolve("clips/a.mp4"), 400],
    ["a traversal", () => Promise.resolve("/tmp/../etc/passwd"), 400],
    ["a UNC share", () => Promise.resolve("\\\\server\\share\\a.mp4"), 400],
    ["a missing file", () => Promise.resolve("/definitely/not/here.mp4"), 404],
    ["a directory", () => Promise.resolve(fixtures.dir), 400],
    ["a playlist renamed to .mp4", () => Promise.resolve(fixtures.playlistAsMp4), 415],
    [
      "a file inside ZKS_HOME",
      async () => {
        const insideHome = join(server.studioHome, "inside.mp4");
        await writeFile(insideHome, await readFile(fixtures.clipMp4));
        return insideHome;
      },
      400,
    ],
    [
      "a symlink outside ZKS_HOME that points inside it",
      async () => {
        const insideHome = join(server.studioHome, "linked-target.mp4");
        await writeFile(insideHome, await readFile(fixtures.clipMp4));
        const outsideLink = join(fixtures.dir, "link-into-home.mp4");
        await symlink(insideHome, outsideLink);
        return outsideLink;
      },
      400,
    ],
  ])("rejects %s and creates nothing", async (_label, makePath, expectedStatus) => {
    const path = await makePath();
    const before = await studioFootprint();

    const response = await createInPlace({ title: "Rejected file", path });

    expect(response.status).toBe(expectedStatus);
    expect(await studioFootprint()).toEqual(before);
  });

  it.each([
    ["no title", {}],
    ["a blank title", { title: "   " }],
    ["a title over the length cap", { title: OVERLONG_TITLE }],
  ])("answers 400 for %s and creates nothing", async (_label, body) => {
    const before = await studioFootprint();
    const response = await createInPlace({ path: fixtures.clipMp4, ...body });
    expect(response.status).toBe(400);
    expect(await studioFootprint()).toEqual(before);
  });

  it("keeps a leftover folder that shares the title's slug when the create fails after its rows are written", async () => {
    const leftoverRaw = join(projectDir(server.studioHome, "leftover-drop"), "media", "raw");
    await mkdir(leftoverRaw, { recursive: true });
    await writeFile(join(leftoverRaw, "precious.mp4"), "footage from before a database reset");
    const before = await studioFootprint();

    // Any database error after createProject, inside the same transaction; NOT VALID spares earlier tests' rows.
    await server.database.rows(sql`alter table studio.media_assets add constraint fail_every_asset check (bytes < 0) not valid`);
    const response = await Promise.resolve(createInPlace({ title: "Leftover Drop", path: fixtures.clipMp4 })).finally(() =>
      server.database.rows(sql`alter table studio.media_assets drop constraint fail_every_asset`),
    );

    expect(response.status).toBe(500);
    expect(await readFile(join(leftoverRaw, "precious.mp4"), "utf8")).toBe("footage from before a database reset");
    expect(await studioFootprint()).toEqual(before);
  });

  it("refuses a peer that is not on this computer", async () => {
    const before = await studioFootprint();
    const init = {
      method: "POST",
      headers: { host: TEST_HOST, "content-type": "application/json" },
      body: JSON.stringify({ title: "Remote", path: fixtures.clipMp4 }),
    };
    const response = await server.app.request(API_ROUTES.createProjectInPlace.path, init, connectionFrom("192.168.1.20"));
    expect(response.status).toBe(403);
    expect(await studioFootprint()).toEqual(before);
  });
});
