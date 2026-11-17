// Created by The Angelo Umali.
// Remote mode on the preview side: the announced URL, the accepted Host and who may frame the composition.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { createPreviewService } from "../../src/preview/preview-service.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { TEST_REMOTE } from "../security/test-app.ts";
import { createTestServer, getRequest, insertProject, type TestServer } from "../support/test-server.ts";
import { createToolFixture, cutSpecFor, insertCameraAsset } from "../tools/tool-fixtures.ts";

const APP_PORT = 4317;
const PREVIEW_PORT = 4318;
const PUBLIC_PREVIEW_HOST = "studio-preview.example.com";

let server: TestServer;
let compositionPath: string;
beforeAll(async () => {
  server = await createTestServer((base) => ({
    previewService: createPreviewService({
      database: base.database.db,
      studioHome: base.studioHome,
      eventBus: base.eventBus,
      logger: base.logger,
      previewPort: PREVIEW_PORT,
      remote: TEST_REMOTE,
      buildComposition: () => Promise.resolve(),
    }),
  }));
  const project = await insertProject(server);
  await createProjectDirs(server.studioHome, project.slug);
  const compositionDir = join(projectDir(server.studioHome, project.slug), "work/preview/v1");
  await mkdir(compositionDir, { recursive: true });
  await writeFile(join(compositionDir, "index.html"), "<!doctype html>");
  compositionPath = `/compositions/${project.id}/v1`;
});
afterAll(async () => {
  await server.close();
});

function previewOrigin(remote?: typeof TEST_REMOTE) {
  return createPreviewOrigin({ database: server.database.db, studioHome: server.studioHome, appPort: APP_PORT, previewPort: PREVIEW_PORT, remote });
}

function frameAncestorsOf(response: Response): string[] {
  const directive = response.headers
    .get("content-security-policy")
    ?.split("; ")
    .find((part) => part.startsWith("frame-ancestors"));
  return directive?.split(" ").slice(1) ?? [];
}

describe("the preview service in remote mode", () => {
  it("announces the composition on the preview public origin", async () => {
    const fixture = await createToolFixture(server);
    const asset = await insertCameraAsset(fixture);
    await writeAgentSpec(fixture.context, { videoId: "v1", kind: "cuts" }, cutSpecFor(asset.id, [{ at: 2, end: 4, reason: "false start" }]));

    await getRequest(server, `/api/projects/${fixture.context.projectId}/videos/v1/edl`);

    await vi.waitFor(() => expect(fixture.events.some((event) => event.type === "preview.ready")).toBe(true));
    const ready = fixture.events.find((event) => event.type === "preview.ready");
    const compositionUrl = new URL(ready?.type === "preview.ready" ? ready.compositionUrl : "");
    expect(compositionUrl.origin).toBe(TEST_REMOTE.previewOrigin);
    expect(compositionUrl.pathname).toBe(`/compositions/${fixture.context.projectId}/v1/index.html`);
  });
});

describe("the preview origin in remote mode", () => {
  it("serves the public preview host and lets the public app origin frame it", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, { headers: { host: PUBLIC_PREVIEW_HOST } });
    expect(response.status).toBe(200);
    expect(frameAncestorsOf(response)).toEqual([`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`, TEST_REMOTE.appOrigin]);
  });

  it("still serves the loopback preview host", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, { headers: { host: `127.0.0.1:${PREVIEW_PORT}` } });
    expect(response.status).toBe(200);
  });

  it("refuses the public app host, which belongs to the app listener", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, { headers: { host: "studio.example.com" } });
    expect(response.status).toBe(403);
  });

  it("refuses the public preview host when remote mode is off", async () => {
    const response = await previewOrigin().request(`${compositionPath}/index.html`, { headers: { host: PUBLIC_PREVIEW_HOST } });
    expect(response.status).toBe(403);
  });
});
