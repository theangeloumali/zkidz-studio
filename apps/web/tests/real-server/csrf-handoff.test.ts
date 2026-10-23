// Created by The Angelo Umali.
// @vitest-environment node
// End to end against the real server: Kai's createSecurity guard in front of the real project routes, no mock guard.
import { API_ROUTES, APP_PORT, CSRF_HEADER, isStateChangingMethod, PREVIEW_PORT } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createSecurity } from "../../../server/src/security/index.ts";
import { connectionFrom, createTestServer, TEST_HOST, type TestServer } from "../../../server/test/support/test-server.ts";

const APP_ORIGIN = `http://${TEST_HOST}`;

let server: TestServer;
const openedFolders: string[] = [];
beforeAll(async () => {
  const security = createSecurity({ appPort: APP_PORT, previewPort: PREVIEW_PORT, container: false });
  server = await createTestServer({
    security: { middleware: security.middleware, confinePath: security.confinePath },
    openFolder: (folderPath) => openedFolders.push(folderPath),
  });
  // Pays react-query's first transform here; inside a test it overran the 5 s budget under ci:local load.
  await import("../../src/render/render-api.ts");
}, 60_000);
afterAll(async () => {
  await server.close();
});

/** Adds only what a browser adds on its own (Host, Sec-Fetch-Site, Origin on writes); the client supplies the rest. */
function routeFetchToServer(): string[] {
  const exchanges: string[] = [];
  vi.stubGlobal("fetch", async (path: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    headers.set("host", TEST_HOST);
    headers.set("sec-fetch-site", "same-origin");
    if (isStateChangingMethod(method)) headers.set("origin", APP_ORIGIN);
    const response = await server.app.request(path, { ...init, method, headers }, connectionFrom("127.0.0.1"));
    exchanges.push(`${method} ${path} ${response.status}`);
    return response;
  });
  return exchanges;
}

// A fresh module per test, so the token cache starts empty like a freshly loaded page.
async function loadClient() {
  vi.resetModules();
  const client = await import("../../src/api/client.ts");
  const createProject = (title: string) =>
    client.requestJson(API_ROUTES.createProject.response, API_ROUTES.createProject.path, { method: "POST", body: { title } });
  return { ...client, createProject };
}

describe("CSRF handoff through the real security middleware", () => {
  it("bootstraps the launch token with a GET, then creates a project (201)", async () => {
    const exchanges = routeFetchToServer();
    const { createProject, fetchProjects } = await loadClient();

    const project = await createProject("Beach day");

    expect(project).toMatchObject({ title: "Beach day" });
    expect(exchanges).toEqual(["GET /api/projects 200", "POST /api/projects 201"]);
    expect((await fetchProjects()).map(({ id }) => id)).toContain(project.id);
  });

  // Stop, the terminal ticket and opening the terminal send no body; the guard still needs the JSON content type on them.
  it("lets a write with no body through the guard (Stop)", async () => {
    const exchanges = routeFetchToServer();
    vi.resetModules();
    const { stopTurn } = await import("../../src/api/agent-client.ts");

    const outcome = await stopTurn("no-such-project").catch((error: unknown) => error);

    expect(exchanges.at(-1)).toMatch(/^POST \/api\/projects\/no-such-project\/stop (?!403)\d+$/);
    expect(String(outcome)).not.toContain("Forbidden: content-type");
  });

  it("sends a bodiless write such as Open folder as JSON, so the guard lets it through", async () => {
    const exchanges = routeFetchToServer();
    const { createProject } = await loadClient();
    const project = await createProject("Open me");
    vi.resetModules();
    const { revealDeliverables } = await import("../../src/render/render-api.ts");

    await expect(revealDeliverables(project.id)).resolves.toEqual({ ok: true });

    expect(exchanges.at(-1)).toBe(`POST /api/projects/${project.id}/reveal 200`);
    expect(openedFolders).toHaveLength(1);
  });

  it("is a real guard: a write carrying a stale token is refused with 403", async () => {
    const exchanges = routeFetchToServer();

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: { [CSRF_HEADER]: "1", "content-type": "application/json" },
      body: JSON.stringify({ title: "Forged" }),
    });

    expect(exchanges).toEqual(["POST /api/projects 403"]);
    expect(await response.json()).toEqual({ error: "Forbidden: csrf" });
  });
});
