// Created by The Angelo Umali.
// On a filesystem without hard links an upload is copied into place: the copy must never hold the database, and a
// failed copy must leave no row, folder or partial file behind.
import { readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { mediaAssets, projects } from "@zks/db/schema";
import { API_ROUTES, MediaAssetSchema, PROJECT_TITLE_HEADER, ProjectSchema, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { projectDir } from "../src/config.ts";
import { hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";
import { connectionFrom, createTestServer, getRequest, insertProject, TEST_HOST, type TestServer } from "./support/test-server.ts";

const filesystem: { hasNoHardLinks: boolean; copiesStarted: number; copyGate: Promise<void>; copyFailure: Error | undefined } = {
  hasNoHardLinks: false,
  copiesStarted: 0,
  copyGate: Promise.resolve(),
  copyFailure: undefined,
};
vi.mock("node:fs/promises", async (importOriginal) => {
  const realFs = await importOriginal<typeof import("node:fs/promises")>();
  const link: typeof realFs.link = async (existingPath, newPath) => {
    if (filesystem.hasNoHardLinks) throw Object.assign(new Error("hard links are not supported here"), { code: "EPERM" });
    return realFs.link(existingPath, newPath);
  };
  const copyFile: typeof realFs.copyFile = async (source, destination, mode) => {
    filesystem.copiesStarted += 1;
    await filesystem.copyGate;
    if (filesystem.copyFailure === undefined) return realFs.copyFile(source, destination, mode);
    await realFs.writeFile(destination, "the first bytes of a copy that ran out of disk", { flag: "wx" });
    throw filesystem.copyFailure;
  };
  return { ...realFs, link, copyFile };
});

const ffmpegAvailable = await hasFfmpeg();
const CreatedSchema = z.strictObject({ project: ProjectSchema, asset: MediaAssetSchema });
const DATABASE_WAIT_MS = 2000;

let server: TestServer;
let fixtures: MediaFixtures;
beforeAll(async () => {
  server = await createTestServer();
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await server.close();
  if (ffmpegAvailable) await rm(fixtures.dir, { recursive: true, force: true });
});
afterEach(() => {
  Object.assign(filesystem, { hasNoHardLinks: false, copiesStarted: 0, copyGate: Promise.resolve(), copyFailure: undefined });
});

function binaryPost(path: string, body: Uint8Array, headers: Record<string, string> = {}) {
  const allHeaders = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: "clip.mp4", ...headers };
  return server.app.request(path, { method: "POST", headers: allHeaders, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

const createWithMedia = (body: Uint8Array, title: string) => binaryPost(API_ROUTES.createProjectWithMedia.path, body, { [PROJECT_TITLE_HEADER]: title });

async function studioFootprint() {
  const projectRows = await server.database.db.select({ id: projects.id }).from(projects);
  const assetRows = await server.database.db.select({ id: mediaAssets.id }).from(mediaAssets);
  const files = (await readdir(join(server.studioHome, "projects"), { recursive: true })).sort();
  return { projectCount: projectRows.length, assetCount: assetRows.length, files };
}

describe.skipIf(!ffmpegAvailable)("committing an upload where hard links fail", () => {
  it("copies the first clip after the project's rows commit, so the database answers during the copy", async () => {
    let releaseCopy: () => void = () => undefined;
    filesystem.hasNoHardLinks = true;
    filesystem.copyGate = new Promise<void>((resolve) => (releaseCopy = resolve));

    const creating = createWithMedia(await readFile(fixtures.clipMp4), "Slow Copy");
    await vi.waitFor(() => expect(filesystem.copiesStarted).toBe(1));
    const waitForDatabase = new Promise<string>((resolve) => setTimeout(() => resolve("blocked"), DATABASE_WAIT_MS));
    const duringCopy = await Promise.race([
      Promise.resolve(getRequest(server, "/api/projects")).then((response) => `answered ${response.status}`),
      waitForDatabase,
    ]);
    releaseCopy();
    const response = await creating;

    expect(duringCopy).toBe("answered 200");
    expect(response.status).toBe(201);
    const { project, asset } = CreatedSchema.parse(await response.json());
    const storedFile = join(projectDir(server.studioHome, project.slug), "media", "raw", `${asset.id}.mp4`);
    const [row] = await server.database.db.select({ mtimeMs: mediaAssets.mtimeMs }).from(mediaAssets).where(eq(mediaAssets.id, asset.id));
    expect(row?.mtimeMs).toBe(Math.trunc((await stat(storedFile)).mtimeMs));
  });

  it("removes the new project, its folder and the partial copy when the first clip's copy fails", async () => {
    filesystem.hasNoHardLinks = true;
    filesystem.copyFailure = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const before = await studioFootprint();

    const response = await createWithMedia(await readFile(fixtures.clipMp4), "Failed Copy");

    expect(response.status).toBe(500);
    expect(await studioFootprint()).toEqual(before);
  });

  it("removes the asset row and the partial copy when an upload's copy fails", async () => {
    const project = await insertProject(server);
    filesystem.hasNoHardLinks = true;
    filesystem.copyFailure = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
    const before = await studioFootprint();

    const response = await binaryPost(`/api/projects/${project.id}/media`, await readFile(fixtures.clipMp4));

    expect(response.status).toBe(500);
    const rawFiles = await readdir(join(projectDir(server.studioHome, project.slug), "media", "raw")).catch(() => []);
    expect(rawFiles).toEqual([]);
    expect((await studioFootprint()).assetCount).toBe(before.assetCount);
  });
});
