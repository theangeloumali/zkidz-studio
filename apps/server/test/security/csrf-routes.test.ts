// Created by The Angelo Umali.
// Threat: any website reaching the local API (plan §11, CSRF row). Every state-changing route in API_ROUTES, on the
// app as main.ts mounts it.
import { API_ROUTES, CSRF_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  BROWSER_WRITE_ROUTES,
  concretePath,
  createGuardedServer,
  guardRejection,
  PREVIEW_ORIGIN,
  sameOriginWriteHeaders,
  sendRequest,
  type GuardedServer,
  type HeaderMap,
} from "./threat-harness.ts";

let guarded: GuardedServer;
beforeAll(async () => {
  guarded = await createGuardedServer();
});
afterAll(async () => {
  await guarded.server.close();
});

// What a hostile page can make a browser send, each paired with the layer that must stop it.
const FORGED_WRITES: readonly [label: string, overrides: HeaderMap, reason: string][] = [
  [
    "a cross-site form post",
    { origin: "https://attacker.example", "sec-fetch-site": "cross-site", "content-type": "application/x-www-form-urlencoded" },
    "fetch-site",
  ],
  ["a same-site page (another localhost port)", { origin: "http://127.0.0.1:8080", "sec-fetch-site": "same-site" }, "fetch-site"],
  ["the preview origin", { origin: PREVIEW_ORIGIN, "sec-fetch-site": "same-site" }, "fetch-site"],
  ["a foreign Origin from a browser without fetch metadata", { origin: "https://attacker.example", "sec-fetch-site": undefined }, "origin"],
  ["a sandboxed frame's null Origin", { origin: "null", "sec-fetch-site": undefined }, "origin"],
  ["no Origin at all", { origin: undefined, "sec-fetch-site": undefined }, "origin"],
  ["no CSRF header", { [CSRF_HEADER]: undefined }, "csrf"],
  ["a guessed CSRF token", { [CSRF_HEADER]: "A".repeat(43) }, "csrf"],
  ["a text/plain body", { "content-type": "text/plain" }, "content-type"],
  ["a multipart body", { "content-type": "multipart/form-data; boundary=x" }, "content-type"],
];

describe("CSRF on every state-changing route in API_ROUTES", () => {
  it("covers every browser write the API declares", () => {
    expect(BROWSER_WRITE_ROUTES.length).toBeGreaterThanOrEqual(24);
    expect(BROWSER_WRITE_ROUTES.map(([name]) => name)).toEqual(
      expect.arrayContaining(["decide", "deleteRule", "connectApiKey", "revealDeliverables", "openTerminal"]),
    );
  });

  describe.each(BROWSER_WRITE_ROUTES)("%s (%s %s)", (_name, method, path, isBinary) => {
    const body = isBinary ? "bytes" : "{}";

    it("passes the guard for the app's own same-origin request", async () => {
      const response = await sendRequest(guarded, path, { method, headers: sameOriginWriteHeaders(guarded.csrfToken, isBinary), body });
      expect(await guardRejection(response)).toBeNull();
    });

    it.each(FORGED_WRITES)("refuses %s", async (_label, overrides, reason) => {
      const headers = { ...sameOriginWriteHeaders(guarded.csrfToken, isBinary), ...overrides };
      const response = await sendRequest(guarded, path, { method, headers, body });
      expect(await guardRejection(response)).toBe(reason);
    });
  });
});

describe("the hooks bridge, the one write without Origin or CSRF", () => {
  const hooksPath = concretePath(API_ROUTES.terminalHooks.path);

  it("answers 401 to a browser-shaped call with no bearer", async () => {
    const headers = { ...sameOriginWriteHeaders(guarded.csrfToken, false) };
    expect((await sendRequest(guarded, hooksPath, { method: "POST", headers, body: "{}" })).status).toBe(401);
  });

  it("refuses a cross-site page that attaches a bearer, before the route sees it", async () => {
    const headers = { authorization: "Bearer guessed", "content-type": "application/json", origin: "https://attacker.example", "sec-fetch-site": "cross-site" };
    expect(await guardRejection(await sendRequest(guarded, hooksPath, { method: "POST", headers, body: "{}" }))).toBe("fetch-site");
  });
});

describe("CORS stays closed", () => {
  it("answers a foreign preflight with 403 and no Access-Control-Allow-Origin", async () => {
    const headers = {
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site",
      "access-control-request-method": "POST",
      "access-control-request-headers": CSRF_HEADER,
    };
    const response = await sendRequest(guarded, API_ROUTES.createRule.path, { method: "OPTIONS", headers });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never hands the CSRF token to a refused request", async () => {
    const response = await sendRequest(guarded, API_ROUTES.listProjects.path, { headers: { "sec-fetch-site": "cross-site" } });
    expect(response.status).toBe(403);
    expect(response.headers.get(CSRF_HEADER)).toBeNull();
  });
});
