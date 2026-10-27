// Created by The Angelo Umali.
// Threat: DNS rebinding (plan §11). After a rebind the attacker's page is same-origin with its own name, so Origin,
// Sec-Fetch-Site and even a token read from a response look valid; the Host allowlist is the only thing that differs.
import { CSRF_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProjectDirs } from "../../src/config.ts";
import { createPreviewOrigin } from "../../src/preview/preview-origin.ts";
import { allowedHostsFor } from "../../src/security/request-guards.ts";
import { checkWebSocketUpgrade, createTicketStore } from "../../src/security/ws-guard.ts";
import { insertProject } from "../support/test-server.ts";
import { ALL_ROUTES, APP_PORT, createGuardedServer, guardRejection, PREVIEW_PORT, REBOUND_HOSTS, sendRequest, type GuardedServer } from "./threat-harness.ts";

let guarded: GuardedServer;
beforeAll(async () => {
  guarded = await createGuardedServer();
});
afterAll(async () => {
  await guarded.server.close();
});

/** Everything a rebound page sends looks same-origin, CSRF token included. */
function reboundHeaders(host: string): Record<string, string> {
  return { host, origin: `http://${host}`, "sec-fetch-site": "same-origin", [CSRF_HEADER]: guarded.csrfToken, "content-type": "application/json" };
}

describe("a rebound Host on the app (4317)", () => {
  describe.each(REBOUND_HOSTS)("Host %s", (host) => {
    it.each(ALL_ROUTES)("refuses %s (%s %s)", async (_name, method, path) => {
      const response = await sendRequest(guarded, path, { method, headers: reboundHeaders(host), body: method === "GET" ? undefined : "{}" });
      expect(await guardRejection(response)).toBe("host");
    });

    it.each(["/", "/projects/x", "/assets/index.js"])("refuses the page route %s", async (path) => {
      expect(await guardRejection(await sendRequest(guarded, path, { headers: reboundHeaders(host) }))).toBe("host");
    });

    it("leaks no CSRF token on the refusal", async () => {
      const response = await sendRequest(guarded, "/api/projects", { headers: reboundHeaders(host) });
      expect(response.headers.get(CSRF_HEADER)).toBeNull();
    });
  });
});

describe("a rebound Host on the terminal WebSocket", () => {
  it.each(REBOUND_HOSTS)("refuses the upgrade from %s and keeps the ticket", (host) => {
    const tickets = createTicketStore();
    const sessionId = crypto.randomUUID();
    const { ticket } = tickets.issue(sessionId);
    const request = new Request(`http://${host}/api/terminal/${sessionId}/ws?ticket=${ticket}`, { headers: { host, origin: `http://${host}` } });
    expect(checkWebSocketUpgrade(request, { allowedHosts: allowedHostsFor(APP_PORT), tickets, sessionId })).toEqual({ ok: false, status: 403, reason: "host" });
    // The refusal must not spend the app's own ticket.
    expect(tickets.redeem(ticket, sessionId)).toBe(true);
  });
});

describe("a rebound Host on the preview origin (4318)", () => {
  it.each([...REBOUND_HOSTS.map((host) => host.replace(`:${APP_PORT}`, `:${PREVIEW_PORT}`)), `127.0.0.1:${APP_PORT}`])("refuses %s", async (host) => {
    const project = await insertProject(guarded.server);
    await createProjectDirs(guarded.server.studioHome, project.slug);
    const preview = createPreviewOrigin({
      database: guarded.server.database.db,
      studioHome: guarded.server.studioHome,
      appPort: APP_PORT,
      previewPort: PREVIEW_PORT,
    });
    const response = await preview.request(`/compositions/${project.id}/v1/index.html`, { headers: { host } });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Forbidden: host" });
  });
});
