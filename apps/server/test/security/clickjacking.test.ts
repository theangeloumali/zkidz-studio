// Created by The Angelo Umali.
// Threat: clickjacking of Approve / Export / Delete (plan §11). The app is never framable; the preview origin is framable by
// the app's own origins only.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { insertProject } from "../support/test-server.ts";
import { APP_PORT, createGuardedServer, guardRejection, PREVIEW_PORT, sendRequest, type GuardedServer } from "./threat-harness.ts";

const PREVIEW_HOST = `127.0.0.1:${PREVIEW_PORT}`;

let guarded: GuardedServer;
let compositionPath: string;
beforeAll(async () => {
  guarded = await createGuardedServer();
  const webDist = join(guarded.server.scratchDir, "web-dist");
  await mkdir(webDist, { recursive: true });
  await writeFile(join(webDist, "index.html"), "<!doctype html><title>studio</title>");

  const project = await insertProject(guarded.server);
  await createProjectDirs(guarded.server.studioHome, project.slug);
  const compositionDir = join(projectDir(guarded.server.studioHome, project.slug), "work/preview/v1");
  await mkdir(compositionDir, { recursive: true });
  await writeFile(join(compositionDir, "index.html"), "<!doctype html>");
  compositionPath = `/compositions/${project.id}/v1`;
});
afterAll(async () => {
  await guarded.server.close();
});

function cspDirectives(response: Response): Map<string, string[]> {
  const policy = response.headers.get("content-security-policy") ?? "";
  return new Map(
    policy
      .split(";")
      .map((directive) => directive.trim().split(/\s+/))
      .map(([name = "", ...values]) => [name, values]),
  );
}

function expectUnframable(response: Response): void {
  expect(cspDirectives(response).get("frame-ancestors")).toEqual(["'none'"]);
  expect(response.headers.get("x-frame-options")).toBe("DENY");
}

describe("the app (4317) refuses to be framed", () => {
  it.each([
    ["the app page", "/", 200],
    ["a client route served by the SPA fallback", "/projects/p1/edit", 200],
    ["an API read", "/api/projects", 200],
    ["an unknown API route", "/api/nope", 404],
  ])("sends frame-ancestors 'none' and X-Frame-Options DENY on %s", async (_label, path, status) => {
    const response = await sendRequest(guarded, path);
    expect(response.status).toBe(status);
    expectUnframable(response);
  });

  it("sends them on a guard refusal", async () => {
    const response = await sendRequest(guarded, "/api/projects", { headers: { "sec-fetch-site": "cross-site" } });
    expect(response.status).toBe(403);
    expectUnframable(response);
  });

  it.each(["iframe", "frame", "embed", "object", "fencedframe"])("refuses to serve the page into an %s, even same-origin", async (destination) => {
    const headers = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": destination };
    expect(await guardRejection(await sendRequest(guarded, "/", { headers }))).toBe("framed");
  });

  it("frames only the preview origin and runs only its own script", async () => {
    const directives = cspDirectives(await sendRequest(guarded, "/"));
    expect(directives.get("frame-src")).toEqual([`http://${PREVIEW_HOST}`]);
    expect(directives.get("script-src")).toEqual(["'self'"]);
  });
});

describe("the preview origin (4318) is framable by the app alone", () => {
  function requestPreview(path: string, init: { host?: string; method?: string } = {}) {
    const preview = createPreviewOrigin({
      database: guarded.server.database.db,
      studioHome: guarded.server.studioHome,
      appPort: APP_PORT,
      previewPort: PREVIEW_PORT,
    });
    return Promise.resolve(preview.request(path, { method: init.method ?? "GET", headers: { host: init.host ?? PREVIEW_HOST } }));
  }

  it.each<[string, () => Promise<Response>, number]>([
    ["a composition page", () => requestPreview(`${compositionPath}/index.html`), 200],
    ["a missing file", () => requestPreview(`${compositionPath}/missing.html`), 404],
    ["a write", () => requestPreview(`${compositionPath}/index.html`, { method: "POST" }), 405],
    ["a foreign Host", () => requestPreview(`${compositionPath}/index.html`, { host: "attacker.example:4318" }), 403],
  ])("names only the app's origins in frame-ancestors on %s", async (_label, send, status) => {
    const response = await send();
    expect(response.status).toBe(status);
    const directives = cspDirectives(response);
    expect(directives.get("frame-ancestors")?.sort()).toEqual([`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`]);
    // Agent-authored script runs here, so it may not reach the network, the API included.
    expect(directives.get("connect-src")).toEqual(["'none'"]);
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
