// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { buildGuardedApp, sendRequest } from "./test-app.ts";

const CROSS_SITE_NAVIGATION = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

describe("Sec-Fetch-Site on reads, SSE and media", () => {
  it.each(["/api/projects", "/api/events", "/api/media/asset-1"])("allows same-origin, none and absent on %s", async (path) => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, path, { headers: { "sec-fetch-site": "same-origin" } })).status).toBe(200);
    expect((await sendRequest(app, path, { headers: { "sec-fetch-site": "none" } })).status).toBe(200);
    expect((await sendRequest(app, path)).status).toBe(200);
  });

  it.each(["cross-site", "same-site", "CROSS-SITE"])("rejects %s on every /api read, SSE and media route", async (site) => {
    const { app } = buildGuardedApp();
    for (const path of ["/api/projects", "/api/events", "/api/media/asset-1", "/api/fs/list?path=/"]) {
      expect((await sendRequest(app, path, { headers: { "sec-fetch-site": site } })).status).toBe(403);
    }
  });

  it("rejects an unknown Sec-Fetch-Site value", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/projects", { headers: { "sec-fetch-site": "bogus" } })).status).toBe(403);
  });

  it("lets a cross-site link open the app page itself", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/", { headers: CROSS_SITE_NAVIGATION })).status).toBe(200);
  });

  it("rejects a cross-site navigation straight to an API route", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/media/asset-1", { headers: CROSS_SITE_NAVIGATION })).status).toBe(403);
  });

  it("treats a percent-encoded API path as an API route", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/%61pi/media/asset-1", { headers: CROSS_SITE_NAVIGATION })).status).toBe(403);
  });

  it("rejects cross-site subresource loads of app assets", async () => {
    const { app } = buildGuardedApp();
    const headers = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "script" };
    expect((await sendRequest(app, "/assets/index.js", { headers })).status).toBe(403);
  });

  it.each(["iframe", "frame", "embed", "object", "fencedframe"])("rejects a page loaded as an %s, even same-origin", async (dest) => {
    const { app } = buildGuardedApp();
    const headers = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "navigate", "sec-fetch-dest": dest };
    expect((await sendRequest(app, "/", { headers })).status).toBe(403);
  });
});
