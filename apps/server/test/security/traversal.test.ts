// Created by The Angelo Umali.
// Threat: path traversal (plan §9.4, §11), every §9.4 case sent over a real socket to the routes that take a path or a
// filename from the request.
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { API_ROUTES, CSRF_HEADER, MediaAssetSchema, UPLOAD_FILENAME_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { hasFfmpeg, makeMediaFixtures, type MediaFixtures } from "../support/media-fixtures.ts";
import { insertProject } from "../support/test-server.ts";
import { listen, rawGet, type Listener } from "./raw-http.ts";
import { APP_HOST, APP_ORIGIN, APP_PORT, createGuardedServer, PREVIEW_PORT, sendRequest, type GuardedServer } from "./threat-harness.ts";

const ffmpegAvailable = await hasFfmpeg();
const SECRET = "SECRET-OUTSIDE-THE-COMPOSITION";
const PREVIEW_HOST = `127.0.0.1:${PREVIEW_PORT}`;
const WINDOWS_ALIAS_NAMES = ["CON", "nul.txt", "index.html.", "index.html ", "index.html:secret", "index.html::$DATA", "..\\..\\cues-secret.json"];

let guarded: GuardedServer;
let previewListener: Listener;
let appListener: Listener;
let compositionPath: string;
let projectId: string;
let projectSlug: string;
let fixtures: MediaFixtures | undefined;
beforeAll(async () => {
  guarded = await createGuardedServer();
  const project = await insertProject(guarded.server);
  projectId = project.id;
  projectSlug = project.slug;
  await createProjectDirs(guarded.server.studioHome, project.slug);
  const projectRoot = projectDir(guarded.server.studioHome, project.slug);
  const compositionDir = join(projectRoot, "work/preview/v1");
  await mkdir(compositionDir, { recursive: true });
  await writeFile(join(compositionDir, "index.html"), "<!doctype html>");
  await writeFile(join(projectRoot, "work/cues-secret.json"), SECRET);
  await writeFile(join(guarded.server.scratchDir, "outside.txt"), SECRET);
  // A file link and a directory link (the POSIX stand-in for a junction), both pointing out of the composition.
  await symlink(join(projectRoot, "work/cues-secret.json"), join(compositionDir, "leak.json"));
  await symlink(projectRoot, join(compositionDir, "linked-dir"), "junction");
  // POSIX can hold these names, so only the Windows-path rules stop them; on Windows they alias other files or devices.
  if (process.platform !== "win32") {
    for (const name of WINDOWS_ALIAS_NAMES) await writeFile(join(compositionDir, name), SECRET);
    for (const name of WINDOWS_ALIAS_NAMES) await mkdir(join(guarded.server.scratchDir, "picker", name), { recursive: true });
  }
  compositionPath = `/compositions/${project.id}/v1`;

  const preview = createPreviewOrigin({
    database: guarded.server.database.db,
    studioHome: guarded.server.studioHome,
    appPort: APP_PORT,
    previewPort: PREVIEW_PORT,
  });
  previewListener = await listen(preview);
  appListener = await listen(guarded.server.app);
  if (ffmpegAvailable) fixtures = await makeMediaFixtures();
});
afterAll(async () => {
  await Promise.all([previewListener.close(), appListener.close()]);
  await guarded.server.close();
});

// Each is appended to the composition folder's URL; the secret is two levels up or outside the studio altogether.
const PREVIEW_TRAVERSALS: readonly [label: string, rawSuffix: string][] = [
  ["dot-dot segments", "../../cues-secret.json"],
  ["URL-encoded slashes", "..%2f..%2fcues-secret.json"],
  ["URL-encoded dots", "%2e%2e/%2e%2e/cues-secret.json"],
  ["double encoding", "%252e%252e%252f%252e%252e%252fcues-secret.json"],
  ["encoded backslashes", "..%5c..%5ccues-secret.json"],
  ["raw backslashes", "..\\..\\cues-secret.json"],
  ["an encoded absolute path", "%2fetc%2fpasswd"],
  ["a NUL byte", "index.html%00.json"],
  ["a UNC path", "//attacker.example/share/x"],
  ["a device path", "//./PhysicalDrive0"],
  ["an alternate data stream", "index.html:secret"],
  ["the default data stream", "index.html::$DATA"],
  ["a reserved device name", "CON"],
  ["a reserved name with an extension", "nul.txt"],
  ["a trailing dot", "index.html."],
  ["a trailing space", "index.html%20"],
  ["a symlinked file", "leak.json"],
  ["a symlinked directory", "linked-dir/work/cues-secret.json"],
];

describe("the preview origin serves only files inside the composition folder", () => {
  it("serves the composition itself over the same socket", async () => {
    expect((await rawGet(previewListener.port, `${compositionPath}/index.html`, PREVIEW_HOST)).status).toBe(200);
  });

  it.each(PREVIEW_TRAVERSALS)("refuses %s", async (_label, rawSuffix) => {
    const response = await rawGet(previewListener.port, `${compositionPath}/${rawSuffix}`, PREVIEW_HOST);
    expect(response.text).not.toContain(SECRET);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it.each(["..", "%2e%2e", "v1%2f..", "V1"])("refuses the video id %j", async (videoId) => {
    const response = await rawGet(previewListener.port, `/compositions/${projectId}/${videoId}/index.html`, PREVIEW_HOST);
    expect(response.status).toBe(404);
  });
});

describe("media is served by assetId, never by path", () => {
  it.each([
    "..%2f..%2fwork%2fcues-secret.json",
    "../../../outside.txt",
    "%2e%2e%2f%2e%2e%2foutside.txt",
    "C:%5cWindows%5cwin.ini",
    "%5c%5cattacker.example%5cshare",
  ])("answers %s with no file bytes", async (rawId) => {
    const response = await rawGet(appListener.port, `/api/media/${rawId}`, APP_HOST);
    expect(response.text).not.toContain(SECRET);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe("the folder picker and in-place registration", () => {
  it.each(["\\\\attacker.example\\share", "//attacker.example/share", "\\\\.\\PhysicalDrive0", "\\\\?\\C:\\", "C:\\clip.mp4:stream"])(
    "refuses to browse %j",
    async (path) => {
      const response = await sendRequest(guarded, `${API_ROUTES.listFolder.path}?path=${encodeURIComponent(path)}`);
      expect(response.status).toBe(400);
    },
  );

  it.skipIf(process.platform === "win32").each(WINDOWS_ALIAS_NAMES.slice(0, 5))("refuses to browse an existing folder named %j", async (name) => {
    const path = join(guarded.server.scratchDir, "picker", name);
    expect((await sendRequest(guarded, `${API_ROUTES.listFolder.path}?path=${encodeURIComponent(path)}`)).status).toBe(400);
  });

  it("refuses to browse the studio folder", async () => {
    const response = await sendRequest(guarded, `${API_ROUTES.listFolder.path}?path=${encodeURIComponent(guarded.server.studioHome)}`);
    expect(response.status).toBe(400);
  });

  it.each<[string, () => string]>([
    ["a folder", () => guarded.server.scratchDir],
    ["a file inside the studio folder", () => join(projectDir(guarded.server.studioHome, projectSlug), "work/cues-secret.json")],
    ["a UNC path", () => "\\\\attacker.example\\share\\clip.mp4"],
  ])("refuses to register %s in place", async (_label, path) => {
    const headers = { origin: APP_ORIGIN, "sec-fetch-site": "same-origin", [CSRF_HEADER]: guarded.csrfToken, "content-type": "application/json" };
    const body = JSON.stringify({ path: path(), title: "In place" });
    const response = await sendRequest(guarded, API_ROUTES.createProjectInPlace.path, { method: "POST", headers, body });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});

describe.skipIf(!ffmpegAvailable)("uploads land at <assetId>.<ext> whatever the filename says", () => {
  async function upload(displayName: string, clipPath = fixtures?.clipMp4 ?? ""): Promise<Response> {
    const headers = {
      origin: APP_ORIGIN,
      "sec-fetch-site": "same-origin",
      [CSRF_HEADER]: guarded.csrfToken,
      "content-type": "application/octet-stream",
      [UPLOAD_FILENAME_HEADER]: encodeURIComponent(displayName),
    };
    const clip = await readFile(clipPath);
    return guarded.server.app.request(`/api/projects/${projectId}/media`, { method: "POST", headers: { host: APP_HOST, ...headers }, body: clip });
  }

  const rawDir = () => join(projectDir(guarded.server.studioHome, projectSlug), "media", "raw");
  const sha256 = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");

  it.each(["../../work/cues-secret.json", "..\\..\\work\\cues-secret.json", "CON.mp4", "clip.mp4:stream", "clip.mp4. ", "\\\\attacker.example\\share\\x.mp4"])(
    "stores %j under its assetId and never writes outside media/raw",
    async (displayName) => {
      const response = await upload(displayName);
      expect(response.status).toBe(201);
      const asset = MediaAssetSchema.parse(await response.json());
      expect(await readdir(rawDir())).toContain(`${asset.id}.mp4`);
      expect(await readFile(join(projectDir(guarded.server.studioHome, projectSlug), "work/cues-secret.json"), "utf8")).toBe(SECRET);
    },
  );

  it("never overwrites an existing asset when the same name is uploaded again", async () => {
    const first = MediaAssetSchema.parse(await (await upload("clip.mp4")).json());
    const firstPath = join(rawDir(), `${first.id}.mp4`);
    const before = await sha256(firstPath);
    const second = MediaAssetSchema.parse(await (await upload("clip.mp4", fixtures?.rotatedMp4)).json());
    expect(second.id).not.toBe(first.id);
    expect(await sha256(firstPath)).toBe(before);
  });
});
