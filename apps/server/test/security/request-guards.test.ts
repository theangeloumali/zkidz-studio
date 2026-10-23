// Created by The Angelo Umali.
import { API_ROUTES, CSRF_HEADER, isStateChangingMethod } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { buildGuardedApp, sendRequest, TEST_APP_HOST, TEST_APP_PORT, TEST_PREVIEW_PORT, validWriteHeaders, type HeaderOverrides } from "./test-app.ts";
import { STUDIO_MCP_ROUTES } from "../../src/tools/mcp-paths.ts";

describe("Host allowlist (DNS rebinding)", () => {
  it.each([TEST_APP_HOST, `localhost:${TEST_APP_PORT}`, `[::1]:${TEST_APP_PORT}`, `LOCALHOST:${TEST_APP_PORT}`])("accepts %s", async (host) => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/projects", { headers: { host } })).status).toBe(200);
  });

  it.each([
    "evil.example:4317",
    "127.0.0.1",
    `127.0.0.1:${TEST_PREVIEW_PORT}`,
    "127.0.0.1:80",
    `127.0.0.2:${TEST_APP_PORT}`,
    `0.0.0.0:${TEST_APP_PORT}`,
    `127.0.0.1:${TEST_APP_PORT}.evil.example`,
    "",
  ])("rejects Host %j on API and page routes", async (host) => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/projects", { headers: { host } })).status).toBe(403);
    expect((await sendRequest(app, "/", { headers: { host } })).status).toBe(403);
  });

  it("rejects a request with no Host header", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/projects", { headers: { host: undefined } })).status).toBe(403);
  });
});

describe("Origin + CSRF header on state-changing methods", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("accepts a same-origin %s with the launch token", async (method) => {
    const { app, csrfToken } = buildGuardedApp();
    expect((await sendRequest(app, "/api/rules", { method, headers: validWriteHeaders(csrfToken), body: "{}" })).status).toBe(200);
  });

  it("accepts the Origin that matches an allowlisted localhost Host", async () => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), host: `localhost:${TEST_APP_PORT}`, origin: `http://localhost:${TEST_APP_PORT}` };
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "{}" })).status).toBe(200);
  });

  it.each<[string, HeaderOverrides]>([
    ["missing Origin", { origin: undefined }],
    ["a cross-site Origin", { origin: "https://evil.example" }],
    ["the preview Origin", { origin: `http://127.0.0.1:${TEST_PREVIEW_PORT}` }],
    ["an opaque null Origin", { origin: "null" }],
    ["an Origin for a different allowlisted host", { origin: `http://localhost:${TEST_APP_PORT}` }],
    ["an https Origin", { origin: `https://${TEST_APP_HOST}` }],
    ["an Origin with a trailing slash", { origin: `http://${TEST_APP_HOST}/` }],
    ["missing CSRF header", { [CSRF_HEADER]: undefined }],
    ["a wrong CSRF token", { [CSRF_HEADER]: "not-the-launch-token" }],
    ["a text/plain body", { "content-type": "text/plain" }],
    ["a form body", { "content-type": "application/x-www-form-urlencoded" }],
    ["a multipart body", { "content-type": "multipart/form-data; boundary=x" }],
    ["a JSON look-alike type", { "content-type": "application/jsonp" }],
    ["missing Content-Type", { "content-type": undefined }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
  ])("rejects a POST with %s", async (_label, overrides) => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), ...overrides };
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "{}" })).status).toBe(403);
  });

  it("rejects a cross-site OPTIONS preflight", async () => {
    const { app } = buildGuardedApp();
    const headers = { origin: "https://evil.example", "access-control-request-method": "POST" };
    expect((await sendRequest(app, "/api/rules", { method: "OPTIONS", headers })).status).toBe(403);
  });

  it("accepts JSON with a charset parameter", async () => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), "content-type": "application/json; charset=utf-8" };
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "{}" })).status).toBe(200);
  });

  it("accepts an octet-stream body only on the streamed upload route", async () => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), "content-type": "application/octet-stream" };
    expect((await sendRequest(app, "/api/projects/p1/media", { method: "POST", headers, body: "bytes" })).status).toBe(200);
    expect((await sendRequest(app, API_ROUTES.createProjectWithMedia.path, { method: "POST", headers, body: "bytes" })).status).toBe(200);
    expect((await sendRequest(app, "/api/projects/p1/media/extra", { method: "POST", headers, body: "bytes" })).status).toBe(403);
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "bytes" })).status).toBe(403);
  });

  const NON_UPLOAD_WRITES = Object.entries(API_ROUTES)
    .filter(([, route]) => isStateChangingMethod(route.method) && !("body" in route && route.body === "binary"))
    .map(([name, route]) => [name, route.method, route.path.replace(/:[A-Za-z]+/g, "p1")] as const);

  it.each(NON_UPLOAD_WRITES)("rejects an octet-stream body on %s (%s %s)", async (_name, method, path) => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), "content-type": "application/octet-stream" };
    const response = await sendRequest(app, path, { method, headers, body: "bytes" });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden: content-type" });
  });

  it.each(["PUT", "PATCH", "DELETE"])("rejects an octet-stream %s on the upload path", async (method) => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), "content-type": "application/octet-stream" };
    expect((await sendRequest(app, "/api/projects/p1/media", { method, headers, body: "bytes" })).status).toBe(403);
  });

  it.each<[string, HeaderOverrides]>([
    ["missing Origin", { origin: undefined }],
    ["missing CSRF header", { [CSRF_HEADER]: undefined }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
  ])("still rejects an upload with %s", async (_label, overrides) => {
    const { app, csrfToken } = buildGuardedApp();
    const headers = { ...validWriteHeaders(csrfToken), "content-type": "application/octet-stream", ...overrides };
    expect((await sendRequest(app, "/api/projects/p1/media", { method: "POST", headers, body: "bytes" })).status).toBe(403);
    expect((await sendRequest(app, API_ROUTES.createProjectWithMedia.path, { method: "POST", headers, body: "bytes" })).status).toBe(403);
  });

  it("gives each launch its own token", () => {
    expect(buildGuardedApp().csrfToken).not.toBe(buildGuardedApp().csrfToken);
  });

  it("hands the launch token to same-origin script in a response header", async () => {
    const { app, csrfToken } = buildGuardedApp();
    const response = await sendRequest(app, "/api/connect", { headers: { "sec-fetch-site": "same-origin" } });
    expect(response.headers.get(CSRF_HEADER)).toBe(csrfToken);
  });
});

describe("bearer carve-out for the hooks bridge and the MCP twin (plan §11)", () => {
  const SESSION_ID = "0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f";
  const atSession = (path: string) => path.replace(":sessionId", SESSION_ID);
  // app.test.ts checks the mounted routes stay behind the same carve-out.
  const BEARER_ROUTES = [
    ["POST", atSession(API_ROUTES.terminalHooks.path)],
    ["GET", atSession(STUDIO_MCP_ROUTES.listTools)],
    ["POST", atSession(STUDIO_MCP_ROUTES.callTool)],
  ] as const;
  // What the hook relay and bin/zks-mcp.mjs send: no Origin, no CSRF header, no fetch metadata.
  const machineHeaders = (method: string): HeaderOverrides => ({
    authorization: "Bearer session-token",
    ...(method === "POST" ? { "content-type": "application/json" } : {}),
  });

  it.each(BEARER_ROUTES)("lets a bearer %s %s through without Origin or CSRF", async (method, path) => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, path, { method, headers: machineHeaders(method), body: method === "POST" ? "{}" : undefined })).status).toBe(200);
  });

  it.each(BEARER_ROUTES)("answers 401 to a tokenless %s %s", async (method, path) => {
    const { app } = buildGuardedApp();
    const headers = { ...machineHeaders(method), authorization: undefined };
    const response = await sendRequest(app, path, { method, headers, body: method === "POST" ? "{}" : undefined });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it.each(BEARER_ROUTES)("still rejects a foreign Origin on %s %s with a token", async (method, path) => {
    const { app } = buildGuardedApp();
    const headers = { ...machineHeaders(method), origin: "https://evil.example" };
    expect((await sendRequest(app, path, { method, headers, body: method === "POST" ? "{}" : undefined })).status).toBe(403);
  });

  it.each(BEARER_ROUTES)("keeps the Host allowlist and Sec-Fetch-Site on %s %s", async (method, path) => {
    const { app } = buildGuardedApp();
    const body = method === "POST" ? "{}" : undefined;
    expect((await sendRequest(app, path, { method, headers: { ...machineHeaders(method), host: "evil.example:4317" }, body })).status).toBe(403);
    expect((await sendRequest(app, path, { method, headers: { ...machineHeaders(method), "sec-fetch-site": "cross-site" }, body })).status).toBe(403);
  });

  it("still requires a JSON body on a bearer write", async () => {
    const { app } = buildGuardedApp();
    const headers = { ...machineHeaders("POST"), "content-type": "text/plain" };
    expect((await sendRequest(app, atSession(API_ROUTES.terminalHooks.path), { method: "POST", headers, body: "{}" })).status).toBe(403);
  });

  it.each([
    ["the ticket route", "POST", atSession(API_ROUTES.terminalTicket.path)],
    ["a path below hooks", "POST", `${atSession(API_ROUTES.terminalHooks.path)}/x`],
    ["a non-UUID session id", "POST", "/api/terminal/p1/hooks"],
    ["an uppercase session id", "POST", `/api/terminal/${SESSION_ID.toUpperCase()}/hooks`],
    ["a GET on the call route", "GET", atSession(STUDIO_MCP_ROUTES.callTool)],
  ])("does not extend the carve-out to %s", async (_label, method, path) => {
    const { app } = buildGuardedApp();
    const response = await sendRequest(app, path, { method, headers: machineHeaders("POST"), body: method === "POST" ? "{}" : undefined });
    // Browser rules apply: a tokenless-looking write is refused for Origin, and a read passes to the route.
    expect(response.status).toBe(method === "POST" ? 403 : 200);
  });

  it("treats a GET on the hooks path as an ordinary read, not a bearer route", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, atSession(API_ROUTES.terminalHooks.path))).status).toBe(200);
  });
});
