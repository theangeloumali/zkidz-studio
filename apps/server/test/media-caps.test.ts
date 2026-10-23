// Created by The Angelo Umali.
// Storage caps under concurrency (plan §9.4): parallel uploads must never jointly pass the project cap or the free-space floor.
import { readdir, readFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { projectDir } from "../src/config.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../src/media-io/store.ts";
import { chunkedBody, hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";
import { connectionFrom, createTestServer, insertProject, TEST_HOST, type TestServer } from "./support/test-server.ts";

// Free bytes the upload dir reports, one reading per statfs call. Real free space on a shared /tmp moves with every
// parallel test and process, so the re-check test scripts the disk instead of measuring it.
const scriptedFreeBytes: number[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const realFs = await importOriginal<typeof import("node:fs/promises")>();
  const scriptedStatfs = (async (dir: string, ...rest: []) => {
    const stats = await realFs.statfs(dir, ...rest);
    const freeBytes = String(dir).endsWith(`media${sep}raw`) ? scriptedFreeBytes.shift() : undefined;
    return freeBytes === undefined ? stats : { ...stats, bsize: 1, bavail: freeBytes };
  }) as typeof realFs.statfs;
  return { ...realFs, statfs: scriptedStatfs };
});

const ffmpegAvailable = await hasFfmpeg();
const FREE_SPACE_UPLOAD_BYTES = 8 * 1024 * 1024;

// One server and fixture set per file, as in media.test: booting a PGlite inside each test timed it out under load.
// Each test isolates by its own project.
const uploadLimits = { ...DEFAULT_UPLOAD_LIMITS };
let server: TestServer;
let fixtures: MediaFixtures;
beforeAll(async () => {
  server = await createTestServer({ uploadLimits }); // the route reads the limits per request
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await server.close();
  if (ffmpegAvailable) await rm(fixtures.dir, { recursive: true, force: true });
});
afterEach(() => {
  Object.assign(uploadLimits, DEFAULT_UPLOAD_LIMITS);
  scriptedFreeBytes.length = 0;
});

function upload(projectId: string, body: NonNullable<RequestInit["body"]>, extraHeaders: Record<string, string> = {}) {
  const headers = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: "clip.mp4", ...extraHeaders };
  return server.app.request(`/api/projects/${projectId}/media`, { method: "POST", headers, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

async function rawMediaFiles(slug: string): Promise<string[]> {
  return readdir(join(projectDir(server.studioHome, slug), "media", "raw")).catch(() => []);
}

describe.skipIf(!ffmpegAvailable)("upload caps under concurrency", () => {
  it.each([
    ["with a declared Content-Length", true],
    ["chunked, with no Content-Length", false],
  ])("stores only one of two parallel uploads that together pass the project cap (%s)", async (_label, declaresLength) => {
    const clip = await readFile(fixtures.clipMp4);
    uploadLimits.maxProjectBytes = Math.floor(clip.length * 1.5);
    const project = await insertProject(server);

    const sendClip = () => (declaresLength ? upload(project.id, clip, { "content-length": String(clip.length) }) : upload(project.id, chunkedBody(clip)));
    const statuses = (await Promise.all([sendClip(), sendClip()])).map((response) => response.status);

    expect(statuses.sort()).toEqual([201, 413]);
    expect(await rawMediaFiles(project.slug)).toHaveLength(1);
  });

  it("re-checks free space after a chunked upload, whose size was unknown up front", async () => {
    Object.assign(uploadLimits, {
      maxFileBytes: FREE_SPACE_UPLOAD_BYTES * 2,
      maxProjectBytes: FREE_SPACE_UPLOAD_BYTES * 2,
      minFreeBytes: FREE_SPACE_UPLOAD_BYTES,
    });
    const project = await insertProject(server);
    // Above the floor before the body arrives (a chunked upload declares nothing), below it once the part is written.
    scriptedFreeBytes.push(FREE_SPACE_UPLOAD_BYTES * 1.5, FREE_SPACE_UPLOAD_BYTES * 0.5);

    const response = await upload(project.id, chunkedBody(new Uint8Array(FREE_SPACE_UPLOAD_BYTES)));

    expect(response.status).toBe(507);
    expect(await rawMediaFiles(project.slug)).toEqual([]);
  });
});
