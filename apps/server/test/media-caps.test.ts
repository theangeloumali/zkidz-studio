// Created by The Angelo Umali.
// Storage caps under concurrency (plan §9.4): parallel uploads must never jointly pass the project cap or the free-space floor.
import { readdir, readFile, rm } from "node:fs/promises";
import { join, sep } from "node:path";
import { UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDir } from "../src/config.ts";
import { DEFAULT_UPLOAD_LIMITS, type UploadLimits } from "../src/media-io/store.ts";
import { hasFfmpeg, makeMediaFixtures } from "./support/media-fixtures.ts";
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
const CHUNK_BYTES = 1024 * 1024;

let server: TestServer | undefined;
let fixturesDir = "";
afterEach(async () => {
  await server?.close();
  server = undefined;
  if (fixturesDir) await rm(fixturesDir, { recursive: true, force: true });
  fixturesDir = "";
  scriptedFreeBytes.length = 0;
});

/** The route reads `uploadLimits` per request, so a test may tighten it after the server starts. */
async function startServer(uploadLimits: UploadLimits): Promise<TestServer> {
  server = await createTestServer({ uploadLimits });
  return server;
}

function upload(target: TestServer, projectId: string, body: NonNullable<RequestInit["body"]>, extraHeaders: Record<string, string> = {}) {
  const headers = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: "clip.mp4", ...extraHeaders };
  return target.app.request(`/api/projects/${projectId}/media`, { method: "POST", headers, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

/** No Content-Length, like a non-browser client streaming chunked. */
function chunkedStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES));
      offset += CHUNK_BYTES;
    },
  });
}

async function rawMediaFiles(target: TestServer, slug: string): Promise<string[]> {
  return readdir(join(projectDir(target.studioHome, slug), "media", "raw")).catch(() => []);
}

describe.skipIf(!ffmpegAvailable)("upload caps under concurrency", () => {
  it.each([
    ["with a declared Content-Length", true],
    ["chunked, with no Content-Length", false],
  ])("stores only one of two parallel uploads that together pass the project cap (%s)", async (_label, declaresLength) => {
    const fixtures = await makeMediaFixtures();
    fixturesDir = fixtures.dir;
    const clip = await readFile(fixtures.clipMp4);
    const target = await startServer({ ...DEFAULT_UPLOAD_LIMITS, maxProjectBytes: Math.floor(clip.length * 1.5) });
    const project = await insertProject(target);

    const sendClip = () =>
      declaresLength ? upload(target, project.id, clip, { "content-length": String(clip.length) }) : upload(target, project.id, chunkedStream(clip));
    const statuses = (await Promise.all([sendClip(), sendClip()])).map((response) => response.status);

    expect(statuses.sort()).toEqual([201, 413]);
    expect(await rawMediaFiles(target, project.slug)).toHaveLength(1);
  });

  it("re-checks free space after a chunked upload, whose size was unknown up front", async () => {
    const limits = { ...DEFAULT_UPLOAD_LIMITS, maxFileBytes: FREE_SPACE_UPLOAD_BYTES * 2, maxProjectBytes: FREE_SPACE_UPLOAD_BYTES * 2 };
    const target = await startServer({ ...limits, minFreeBytes: FREE_SPACE_UPLOAD_BYTES });
    const project = await insertProject(target);
    // Above the floor before the body arrives (a chunked upload declares nothing), below it once the part is written.
    scriptedFreeBytes.push(FREE_SPACE_UPLOAD_BYTES * 1.5, FREE_SPACE_UPLOAD_BYTES * 0.5);

    const response = await upload(target, project.id, chunkedStream(new Uint8Array(FREE_SPACE_UPLOAD_BYTES)));

    expect(response.status).toBe(507);
    expect(await rawMediaFiles(target, project.slug)).toEqual([]);
  });
});
