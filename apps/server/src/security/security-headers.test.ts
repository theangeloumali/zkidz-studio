// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { buildGuardedApp, sendRequest, TEST_PREVIEW_PORT } from "./test-app.ts";

const HARDENING_HEADERS = {
  "x-frame-options": "DENY",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "same-origin",
};

function parseCsp(policy: string): Map<string, string[]> {
  const directives = policy.split(";").map((directive) => directive.trim().split(/\s+/));
  return new Map(directives.map(([name = "", ...values]) => [name, values]));
}

describe("security response headers", () => {
  it.each(["/", "/api/projects", "/api/media/asset-1"])("sends the hardening headers on %s", async (path) => {
    const { app } = buildGuardedApp();
    const response = await sendRequest(app, path);
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) expect(response.headers.get(name)).toBe(value);
  });

  it("sends the hardening headers on a rejected request too", async () => {
    const { app } = buildGuardedApp();
    const response = await sendRequest(app, "/api/projects", { headers: { host: "evil.example" } });
    expect(response.status).toBe(403);
    for (const [name, value] of Object.entries(HARDENING_HEADERS)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("sends a CSP that forbids framing, inline script and foreign connections and allows only the preview frame", async () => {
    const { app } = buildGuardedApp();
    const directives = parseCsp((await sendRequest(app, "/")).headers.get("content-security-policy") ?? "");
    expect(directives.get("default-src")).toEqual(["'self'"]);
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("connect-src")).toEqual(["'self'"]);
    expect(directives.get("object-src")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'self'"]);
    expect(directives.get("frame-src")).toEqual([`http://127.0.0.1:${TEST_PREVIEW_PORT}`]);
  });

  it("never sends Access-Control-Allow-Origin, even when a handler sets it", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/leaky")).headers.get("access-control-allow-origin")).toBeNull();
  });
});
