// Created by The Angelo Umali.
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { createTestServer, insertProject, type TestServer } from "../support/test-server.ts";

const APP_PORT = 4317;
const PREVIEW_PORT = 4318;
const PREVIEW_HOST = `127.0.0.1:${PREVIEW_PORT}`;
const COMPOSITION_HTML = "<!doctype html><title>composition</title>";

let server: TestServer;
let compositionPath: string;
let projectRoot: string;
beforeAll(async () => {
  server = await createTestServer();
  const project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  projectRoot = projectDir(server.studioHome, project.slug);
  const compositionDir = join(projectRoot, "work/preview/v1");
  await mkdir(join(compositionDir, "vendor"), { recursive: true });
  await writeFile(join(compositionDir, "index.html"), COMPOSITION_HTML);
  await writeFile(join(compositionDir, "vendor/gsap.min.js"), "window.gsap = {};");
  compositionPath = `/compositions/${project.id}/v1`;
});
afterAll(async () => {
  await server.close();
});

function previewOrigin() {
  return createPreviewOrigin({ database: server.database.db, studioHome: server.studioHome, appPort: APP_PORT, previewPort: PREVIEW_PORT });
}

function requestPreview(path: string, init: { host?: string; method?: string } = {}) {
  return previewOrigin().request(path, { method: init.method ?? "GET", headers: { host: init.host ?? PREVIEW_HOST } });
}

describe("the 4318 preview origin", () => {
  it("serves the built composition with a CSP that forbids the network and frames only from the app", async () => {
    const response = await requestPreview(`${compositionPath}/index.html`);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(COMPOSITION_HTML);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toBe(
      `default-src 'self'; connect-src 'none'; frame-ancestors http://127.0.0.1:${APP_PORT} http://localhost:${APP_PORT} http://[::1]:${APP_PORT}`,
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("lets the app frame it when opened as localhost, a Host the app itself accepts", async () => {
    const response = await requestPreview(`${compositionPath}/index.html`, { host: `localhost:${PREVIEW_PORT}` });
    const frameAncestors = response.headers
      .get("content-security-policy")
      ?.split("; ")
      .find((directive) => directive.startsWith("frame-ancestors"));
    expect(response.status).toBe(200);
    expect(frameAncestors?.split(" ")).toContain(`http://localhost:${APP_PORT}`);
  });

  it("serves the composition's own scripts", async () => {
    const response = await requestPreview(`${compositionPath}/vendor/gsap.min.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
  });

  it("refuses an API request", async () => {
    const listing = await requestPreview("/api/projects");
    const write = await requestPreview("/api/projects", { method: "POST" });

    expect(listing.status).toBe(404);
    expect(write.status).toBe(404);
    expect(await listing.text()).not.toContain("projects");
  });

  it("refuses a foreign Host", async () => {
    const response = await requestPreview(`${compositionPath}/index.html`, { host: "evil.example:4318" });
    expect(response.status).toBe(403);
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
  });

  it("refuses the app's own Host, so a rebound name cannot reach it", async () => {
    const response = await requestPreview(`${compositionPath}/index.html`, { host: `127.0.0.1:${APP_PORT}` });
    expect(response.status).toBe(403);
  });

  it("refuses every method but GET and HEAD", async () => {
    const response = await requestPreview(`${compositionPath}/index.html`, { method: "POST" });
    expect(response.status).toBe(405);
  });

  it("serves nothing outside the composition folder", async () => {
    await writeFile(join(projectRoot, "work/cues-secret.json"), "{}");
    await symlink(join(projectRoot, "work/cues-secret.json"), join(projectRoot, "work/preview/v1/leak.json")).catch(() => undefined);

    const traversal = await requestPreview(`${compositionPath}/..%2F..%2Fcues-secret.json`);
    const linked = await requestPreview(`${compositionPath}/leak.json`);
    const badVideo = await requestPreview(compositionPath.replace("/v1", "/..") + "/index.html");

    expect(traversal.status).toBe(404);
    expect(linked.status).toBe(404);
    expect(badVideo.status).toBe(404);
  });
});
