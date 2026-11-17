// Created by The Angelo Umali.
// Remote mode on the preview side: the announced URL, the accepted Host and who may frame the composition.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createProjectDirs, projectDir } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { createPreviewService } from "../../src/preview/preview-service.ts";
import { writeAgentSpec } from "../../src/tools/spec-store.ts";
import { PROXY_SECRET_HEADER } from "../../src/security/proxy-proof.ts";
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

const PROXY_PEER = "172.18.0.5";
/** Requests as Caddy sends them: a non-loopback peer carrying the proxy secret. */
const viaProxy = (host: string): RequestInit & { headers: Record<string, string> } => ({ headers: { host, [PROXY_SECRET_HEADER]: TEST_REMOTE.proxySecret } });
const proxyEnv = { incoming: { socket: { remoteAddress: PROXY_PEER } } };

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
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, viaProxy(PUBLIC_PREVIEW_HOST), proxyEnv);
    expect(response.status).toBe(200);
    expect(frameAncestorsOf(response)).toEqual([`http://127.0.0.1:${APP_PORT}`, `http://localhost:${APP_PORT}`, TEST_REMOTE.appOrigin]);
  });

  it("still serves the loopback preview host", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, viaProxy(`127.0.0.1:${PREVIEW_PORT}`), proxyEnv);
    expect(response.status).toBe(200);
  });

  it("refuses the public app host, which belongs to the app listener", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(`${compositionPath}/index.html`, viaProxy("studio.example.com"), proxyEnv);
    expect(response.status).toBe(403);
  });

  it("refuses the public preview host when remote mode is off", async () => {
    const response = await previewOrigin().request(`${compositionPath}/index.html`, viaProxy(PUBLIC_PREVIEW_HOST), proxyEnv);
    expect(response.status).toBe(403);
  });
});

describe("the preview origin needs proof that the peer is the proxy", () => {
  const url = () => `${compositionPath}/index.html`;
  const from = (peer: string) => ({ incoming: { socket: { remoteAddress: peer } } });

  it("refuses a non-loopback peer with no or a wrong secret, on any host", async () => {
    for (const host of [PUBLIC_PREVIEW_HOST, `127.0.0.1:${PREVIEW_PORT}`]) {
      const bare = await previewOrigin(TEST_REMOTE).request(url(), { headers: { host } }, from("172.18.0.9"));
      expect(bare.status).toBe(403);
      expect(await bare.json()).toEqual({ error: "Forbidden: proxy" });
      const wrong = await previewOrigin(TEST_REMOTE).request(url(), { headers: { host, [PROXY_SECRET_HEADER]: "x".repeat(40) } }, from("172.18.0.9"));
      expect(wrong.status).toBe(403);
    }
  });

  it("passes a loopback peer with no secret", async () => {
    const response = await previewOrigin(TEST_REMOTE).request(url(), { headers: { host: `127.0.0.1:${PREVIEW_PORT}` } }, from("127.0.0.1"));
    expect(response.status).toBe(200);
  });

  it("does not ask for the secret when remote mode is off", async () => {
    const response = await previewOrigin().request(url(), { headers: { host: `127.0.0.1:${PREVIEW_PORT}` } }, from("172.18.0.9"));
    expect(response.status).toBe(200);
  });
});
