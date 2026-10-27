// Created by The Angelo Umali.
import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTES, MediaAssetSchema, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { projectDir } from "../src/config.ts";
import { DEFAULT_UPLOAD_LIMITS } from "../src/media-io/store.ts";
import { chunkedBody, hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "./support/media-fixtures.ts";
import { connectionFrom, createTestServer, getRequest, insertProject, postJson, TEST_HOST, type TestServer } from "./support/test-server.ts";

const ffmpegAvailable = await hasFfmpeg();
const SMALL_FILE_CAP = 64 * 1024;
const SMALL_PROJECT_CAP = 96 * 1024;

let server: TestServer;
let fixtures: MediaFixtures;
beforeAll(async () => {
  server = await createTestServer({ uploadLimits: { ...DEFAULT_UPLOAD_LIMITS, maxFileBytes: SMALL_FILE_CAP, maxProjectBytes: SMALL_PROJECT_CAP } });
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await server.close();
  if (ffmpegAvailable) await rm(fixtures.dir, { recursive: true, force: true });
});

function upload(projectId: string, body: NonNullable<RequestInit["body"]>, displayName = "My Clip.mp4", extraHeaders: Record<string, string> = {}) {
  const headers = { host: TEST_HOST, "content-type": "application/octet-stream", [UPLOAD_FILENAME_HEADER]: encodeURIComponent(displayName), ...extraHeaders };
  return server.app.request(`/api/projects/${projectId}/media`, { method: "POST", headers, body, duplex: "half" }, connectionFrom("127.0.0.1"));
}

async function rawMediaFiles(slug: string): Promise<string[]> {
  return readdir(join(projectDir(server.studioHome, slug), "media", "raw")).catch(() => []);
}

describe.skipIf(!ffmpegAvailable)("POST /api/projects/:projectId/media", () => {
  it("stores the upload as <assetId>.<ext>, records the probe and leaves no .part behind", async () => {
    const project = await insertProject(server);
    const response = await upload(project.id, await readFile(fixtures.clipMp4), "../../evil name.MP4");
    expect(response.status).toBe(201);
    const asset = MediaAssetSchema.parse(await response.json());
    expect(asset).toMatchObject({ projectId: project.id, kind: "camera", name: "evil name.MP4", isInPlace: false, width: 64, height: 36 });
    expect(asset.fps).toEqual({ num: 30000, den: 1001 });
    expect(await rawMediaFiles(project.slug)).toEqual([`${asset.id}.mp4`]);

    const listing = (await (await getRequest(server, `/api/projects/${project.id}/media`)).json()) as { assets: unknown[] };
    expect(listing.assets.map((entry) => MediaAssetSchema.parse(entry))).toEqual([asset]);
  });

  it("rejects a playlist disguised as .mp4 with 415 and deletes the partial file", async () => {
    const project = await insertProject(server);
    const response = await upload(project.id, await readFile(fixtures.playlistAsMp4));
    expect(response.status).toBe(415);
    expect(await rawMediaFiles(project.slug)).toEqual([]);
  });

  it("refuses a declared Content-Length over the file cap before reading the body", async () => {
    const project = await insertProject(server);
    const response = await upload(project.id, new Uint8Array(16), "big.mp4", { "content-length": String(SMALL_FILE_CAP + 1) });
    expect(response.status).toBe(413);
  });

  it("stops a chunked body at the file cap and deletes the partial file", async () => {
    const project = await insertProject(server);
    const response = await upload(project.id, chunkedBody(new Uint8Array(SMALL_FILE_CAP * 2)));
    expect(response.status).toBe(413);
    expect(await rawMediaFiles(project.slug)).toEqual([]);
  });

  it("refuses an upload that would take the project past its total cap", async () => {
    const project = await insertProject(server);
    const clip = await readFile(fixtures.clipMp4);
    let lastStatus = 201;
    let storedBytes = 0;
    while (lastStatus === 201) {
      lastStatus = (await upload(project.id, clip)).status;
      if (lastStatus === 201) storedBytes += clip.length;
    }
    expect(lastStatus).toBe(413);
    expect(storedBytes).toBeLessThanOrEqual(SMALL_PROJECT_CAP);
  }, 30_000); // every accepted upload runs a real ffprobe, several seconds each on a loaded machine

  it("answers 404 for an unknown project and 400 without a filename", async () => {
    expect((await upload(crypto.randomUUID(), new Uint8Array(4))).status).toBe(404);
    const project = await insertProject(server);
    const response = await server.app.request(
      `/api/projects/${project.id}/media`,
      { method: "POST", headers: { host: TEST_HOST, "content-type": "application/octet-stream" }, body: new Uint8Array(4) },
      connectionFrom("127.0.0.1"),
    );
    expect(response.status).toBe(400);
  });
});

describe.skipIf(!ffmpegAvailable)("GET /api/media/:assetId", () => {
  async function uploadedClip() {
    const project = await insertProject(server);
    const bytes = await readFile(fixtures.clipMp4);
    const asset = MediaAssetSchema.parse(await (await upload(project.id, bytes)).json());
    return { asset, bytes };
  }

  it("serves the whole file with Accept-Ranges and a video content type", async () => {
    const { asset, bytes } = await uploadedClip();
    const response = await getRequest(server, `/api/media/${asset.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it("serves a byte range with 206 and Content-Range", async () => {
    const { asset, bytes } = await uploadedClip();
    const response = await getRequest(server, `/api/media/${asset.id}`, { range: "bytes=10-19" });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 10-19/${bytes.length}`);
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes.subarray(10, 20))).toBe(true);
  });

  it("answers 416 for a range past the end", async () => {
    const { asset, bytes } = await uploadedClip();
    const response = await getRequest(server, `/api/media/${asset.id}`, { range: `bytes=${bytes.length}-` });
    expect(response.status).toBe(416);
    expect(response.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
  });

  it("stops serving an in-place file once its path no longer resolves to the registered realpath", async () => {
    const original = join(fixtures.dir, "in-place-original.mp4");
    await writeFile(original, await readFile(fixtures.clipMp4));
    const created = await postJson(server, API_ROUTES.createProjectInPlace.path, { title: "Moved", path: original });
    const { asset } = API_ROUTES.createProjectInPlace.response.parse(await created.json());
    expect((await getRequest(server, `/api/media/${asset.id}`)).status).toBe(200);

    await rm(original);
    await symlink(fixtures.garbage, original);
    expect((await getRequest(server, `/api/media/${asset.id}`)).status).toBe(404);
  });

  it("answers 404 for an unknown or malformed asset id", async () => {
    expect((await getRequest(server, `/api/media/${crypto.randomUUID()}`)).status).toBe(404);
    expect((await getRequest(server, "/api/media/..%2F..%2Fetc%2Fpasswd")).status).toBe(404);
  });
});

// Plan §8.4: the live preview plays the 1080 H.264 proxy. The original can be a phone's 4K HEVC, which Chrome cannot decode.
describe("GET /api/projects/:projectId/videos/:videoId/proxy", () => {
  async function projectWithProxy() {
    const project = await insertProject(server);
    const mezz = join(projectDir(server.studioHome, project.slug), "work", "mezz");
    await mkdir(mezz, { recursive: true });
    const bytes = Buffer.from("proxy bytes, h264 in an mp4");
    await writeFile(join(mezz, "v1.mp4"), bytes);
    return { project, bytes };
  }

  it("serves the video's proxy from work/mezz with byte ranges", async () => {
    const { project, bytes } = await projectWithProxy();
    const whole = await getRequest(server, `/api/projects/${project.id}/videos/v1/proxy`);
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(Buffer.from(await whole.arrayBuffer())).toEqual(bytes);
    const part = await getRequest(server, `/api/projects/${project.id}/videos/v1/proxy`, { range: "bytes=0-4" });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe("proxy");
  });

  it("answers 404 before the proxy exists, and for a malformed video or project id", async () => {
    const { project } = await projectWithProxy();
    expect((await getRequest(server, `/api/projects/${project.id}/videos/v2/proxy`)).status).toBe(404);
    expect((await getRequest(server, `/api/projects/${project.id}/videos/..%2F..%2Fv1/proxy`)).status).toBe(404);
    expect((await getRequest(server, `/api/projects/${crypto.randomUUID()}/videos/v1/proxy`)).status).toBe(404);
  });
});

describe("GET /api/fs/list", () => {
  it("lists folders first, hides dot entries and ZKS_HOME, and reports file sizes", async () => {
    const browsed = join(server.scratchDir, "browse");
    await mkdir(join(browsed, "b-folder"), { recursive: true });
    await mkdir(join(browsed, ".hidden"), { recursive: true });
    await writeFile(join(browsed, "a-file.mp4"), "12345");
    await writeFile(join(browsed, ".secret"), "x");
    const response = await getRequest(server, `/api/fs/list?path=${encodeURIComponent(browsed)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      path: browsed,
      entries: [
        { name: "b-folder", isDirectory: true },
        { name: "a-file.mp4", isDirectory: false, bytes: 5 },
      ],
    });
    const parentListing = (await (await getRequest(server, `/api/fs/list?path=${encodeURIComponent(server.scratchDir)}`)).json()) as {
      entries: { name: string }[];
    };
    expect(parentListing.entries.map((entry) => entry.name)).not.toContain("home");
  });

  it("defaults to the user's home folder", async () => {
    const response = await getRequest(server, "/api/fs/list");
    expect(response.status).toBe(200);
  });

  it.each([
    ["a relative path", "relative/folder", 400],
    ["a device path", "\\\\.\\PhysicalDrive0", 400],
    ["an encoded traversal", "/tmp/%2e%2e/etc", 400],
    ["a missing folder", "/definitely/not/here", 404],
  ])("rejects %s", async (_label, candidatePath, expectedStatus) => {
    expect((await getRequest(server, `/api/fs/list?path=${encodeURIComponent(candidatePath)}`)).status).toBe(expectedStatus);
  });

  it("refuses ZKS_HOME itself and a non-loopback peer", async () => {
    expect((await getRequest(server, `/api/fs/list?path=${encodeURIComponent(server.studioHome)}`)).status).toBe(400);
    const remote = await server.app.request(`/api/fs/list`, { headers: { host: TEST_HOST } }, connectionFrom("172.17.0.1"));
    expect(remote.status).toBe(403);
  });
});
