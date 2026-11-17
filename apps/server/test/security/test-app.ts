// Created by The Angelo Umali.
// Shared harness for the security tests: a Hono app with the middleware mounted first, as the server does.
import { CSRF_HEADER } from "@zks/shared";
import { Hono } from "hono";
import { createSecurity } from "../../src/security/index.ts";
import type { RemoteOrigins } from "../../src/security/remote-origins.ts";

export const TEST_APP_PORT = 4317;
export const TEST_PREVIEW_PORT = 4318;
export const TEST_APP_HOST = `127.0.0.1:${TEST_APP_PORT}`;
export const TEST_APP_ORIGIN = `http://${TEST_APP_HOST}`;
export const TEST_REMOTE: RemoteOrigins = {
  appOrigin: "https://studio.example.com",
  previewOrigin: "https://studio-preview.example.com",
  proxySecret: "test-proxy-secret-0123456789-abcdefghij",
};
export const TEST_REMOTE_HOST = "studio.example.com";

export type HeaderOverrides = Record<string, string | undefined>;

export function buildGuardedApp(remote?: RemoteOrigins) {
  const security = createSecurity({ appPort: TEST_APP_PORT, previewPort: TEST_PREVIEW_PORT, container: false, remote });
  const app = new Hono();
  app.use(security.middleware);
  app.get("/api/leaky", (c) => {
    c.header("Access-Control-Allow-Origin", "*");
    return c.text("ok");
  });
  app.all("*", (c) => c.text("ok"));
  return { app, csrfToken: security.csrfToken };
}

/** Undefined values delete a header, so a test can remove one from a valid set. */
function definedHeaders(headers: HeaderOverrides): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

/** `peer` stands in for the TCP peer address the node server reports on the incoming socket. */
export function sendRequest(app: Hono, path: string, init: { method?: string; headers?: HeaderOverrides; body?: string; peer?: string } = {}) {
  const headers = definedHeaders({ host: TEST_APP_HOST, ...init.headers });
  const env = init.peer === undefined ? undefined : { incoming: { socket: { remoteAddress: init.peer } } };
  return app.request(path, { method: init.method ?? "GET", headers, body: init.body }, env);
}

export function validWriteHeaders(csrfToken: string): HeaderOverrides {
  return { origin: TEST_APP_ORIGIN, [CSRF_HEADER]: csrfToken, "content-type": "application/json", "sec-fetch-site": "same-origin" };
}
