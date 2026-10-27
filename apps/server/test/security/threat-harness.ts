// Created by The Angelo Umali.
// The threat-model suite's harness: the app exactly as main.ts builds it, with the real security middleware, so a test
// fails when a control is unmounted as well as when its logic breaks.
import { API_ROUTES, CSRF_HEADER, isStateChangingMethod } from "@zks/shared";
import { createSecurity } from "../../src/security/index.ts";
import { connectionFrom, createTestServer, type TestServer } from "../support/test-server.ts";

export const APP_PORT = 4317;
export const PREVIEW_PORT = 4318;
export const APP_HOST = `127.0.0.1:${APP_PORT}`;
export const APP_ORIGIN = `http://${APP_HOST}`;
export const PREVIEW_ORIGIN = `http://127.0.0.1:${PREVIEW_PORT}`;
/** The browser's Host and Origin after an attacker's name is rebound to 127.0.0.1. */
export const REBOUND_HOSTS = [
  `attacker.example:${APP_PORT}`,
  `127.0.0.1.nip.io:${APP_PORT}`,
  `localhost.attacker.example:${APP_PORT}`,
  `localhost.:${APP_PORT}`,
  `[::ffff:7f00:1]:${APP_PORT}`,
  `127.1:${APP_PORT}`,
] as const;

export type HeaderMap = Record<string, string | undefined>;

export interface GuardedServer {
  readonly server: TestServer;
  readonly csrfToken: string;
}

export async function createGuardedServer(): Promise<GuardedServer> {
  const security = createSecurity({ appPort: APP_PORT, previewPort: PREVIEW_PORT, container: false });
  const server = await createTestServer({ security });
  return { server, csrfToken: security.csrfToken };
}

/** Every `:param` filled with one UUID, which also satisfies the session-id pattern of the bearer routes. */
export function concretePath(routePath: string, id = "0b6f3c1e-8a2d-4c5b-9e7f-1a2b3c4d5e6f"): string {
  return routePath.replace(/:[A-Za-z]+/g, id);
}

type RouteEntry = readonly [name: string, method: string, path: string, isBinary: boolean];

function toEntry([name, route]: [string, (typeof API_ROUTES)[keyof typeof API_ROUTES]]): RouteEntry {
  return [name, route.method, concretePath(route.path), "body" in route && route.body === "binary"];
}

export const ALL_ROUTES: readonly RouteEntry[] = Object.entries(API_ROUTES).map(toEntry);
/** Browser-facing writes; the hooks bridge authenticates by bearer instead and has its own tests. */
export const BROWSER_WRITE_ROUTES: readonly RouteEntry[] = ALL_ROUTES.filter(([name, method]) => isStateChangingMethod(method) && name !== "terminalHooks");

export function sendRequest(
  { server }: GuardedServer,
  path: string,
  init: { method?: string; headers?: HeaderMap; body?: string; peer?: string } = {},
): Promise<Response> {
  const headers = Object.fromEntries(Object.entries({ host: APP_HOST, ...init.headers }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return Promise.resolve(server.app.request(path, { method: init.method ?? "GET", headers, body: init.body }, connectionFrom(init.peer ?? "127.0.0.1")));
}

/** What the app's own fetch sends on a write. */
export function sameOriginWriteHeaders(csrfToken: string, isBinary: boolean): HeaderMap {
  return {
    origin: APP_ORIGIN,
    "sec-fetch-site": "same-origin",
    [CSRF_HEADER]: csrfToken,
    "content-type": isBinary ? "application/octet-stream" : "application/json",
  };
}

/** The guard's own refusal body; a handler's 403 never looks like this. */
export async function guardRejection(response: Response): Promise<string | null> {
  if (response.status !== 403) return null;
  const body = (await response.json()) as { error?: unknown };
  return typeof body.error === "string" && body.error.startsWith("Forbidden: ") ? body.error.slice("Forbidden: ".length) : null;
}
