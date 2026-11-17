// Created by The Angelo Umali.
// Remote mode (docs/user/docker.md): the public hosts join the allowlist and carry https Origins; everything else holds.
import { CSRF_HEADER } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { PROXY_SECRET_HEADER } from "../../src/security/proxy-proof.ts";
import { allowedHostsFor } from "../../src/security/request-guards.ts";
import { checkWebSocketUpgrade, createTicketStore } from "../../src/security/ws-guard.ts";
import { buildGuardedApp, sendRequest as sendBare, TEST_APP_HOST, TEST_APP_PORT, TEST_REMOTE, TEST_REMOTE_HOST, validWriteHeaders } from "./test-app.ts";

const PUBLIC_ORIGIN = TEST_REMOTE.appOrigin;
const PROXY_PEER = "172.18.0.5";
const OTHER_CONTAINER_PEER = "172.18.0.9";

/** Behaves like Caddy on the docker network: a non-loopback peer that carries the proxy secret. */
const sendRequest: typeof sendBare = (app, path, init = {}) =>
  sendBare(app, path, { peer: PROXY_PEER, ...init, headers: { [PROXY_SECRET_HEADER]: TEST_REMOTE.proxySecret, ...init.headers } });
const SESSION_ID = "session-1";

function publicWriteHeaders(csrfToken: string) {
  return { ...validWriteHeaders(csrfToken), host: TEST_REMOTE_HOST, origin: PUBLIC_ORIGIN };
}

function upgradeRequest(ticket: string, headers: Record<string, string>): Request {
  return new Request(`${PUBLIC_ORIGIN}/api/terminal/${SESSION_ID}/ws?ticket=${ticket}`, { headers });
}

function checkUpgrade(request: Request, tickets: ReturnType<typeof createTicketStore>) {
  return checkWebSocketUpgrade(request, {
    allowedHosts: allowedHostsFor(TEST_APP_PORT, TEST_REMOTE),
    tickets,
    sessionId: SESSION_ID,
    remote: TEST_REMOTE,
    peerAddress: PROXY_PEER,
  });
}

describe("allowedHostsFor", () => {
  it("adds only the public app host", () => {
    expect(allowedHostsFor(TEST_APP_PORT, TEST_REMOTE)).toEqual([...allowedHostsFor(TEST_APP_PORT), TEST_REMOTE_HOST]);
  });
});

describe("the request guard in remote mode", () => {
  it("answers the public host and keeps the loopback hosts", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    expect((await sendRequest(app, "/api/projects", { headers: { host: TEST_REMOTE_HOST } })).status).toBe(200);
    expect((await sendRequest(app, "/api/projects", { headers: { host: TEST_APP_HOST } })).status).toBe(200);
  });

  it("accepts a write whose Origin is exactly the public https origin", async () => {
    const { app, csrfToken } = buildGuardedApp(TEST_REMOTE);
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers: publicWriteHeaders(csrfToken), body: "{}" })).status).toBe(200);
  });

  it("still takes the loopback http Origin on the loopback host", async () => {
    const { app, csrfToken } = buildGuardedApp(TEST_REMOTE);
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers: validWriteHeaders(csrfToken), body: "{}" })).status).toBe(200);
  });

  it.each([
    ["an http Origin for the public host", { origin: `http://${TEST_REMOTE_HOST}` }],
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["the preview public Origin", { origin: TEST_REMOTE.previewOrigin }],
    ["the public Origin with a trailing slash", { origin: `${PUBLIC_ORIGIN}/` }],
    ["missing Origin", { origin: undefined }],
    ["a wrong CSRF token", { [CSRF_HEADER]: "not-the-launch-token" }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
  ])("refuses a public-host write with %s", async (_label, overrides) => {
    const { app, csrfToken } = buildGuardedApp(TEST_REMOTE);
    const headers = { ...publicWriteHeaders(csrfToken), ...overrides };
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "{}" })).status).toBe(403);
  });

  it("refuses the public https Origin on a loopback host", async () => {
    const { app, csrfToken } = buildGuardedApp(TEST_REMOTE);
    const headers = { ...validWriteHeaders(csrfToken), origin: PUBLIC_ORIGIN };
    expect((await sendRequest(app, "/api/rules", { method: "POST", headers, body: "{}" })).status).toBe(403);
  });

  it("refuses the preview public host on the app listener", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    expect((await sendRequest(app, "/api/projects", { headers: { host: "studio-preview.example.com" } })).status).toBe(403);
  });

  it("refuses the public host when remote mode is off", async () => {
    const { app } = buildGuardedApp();
    expect((await sendRequest(app, "/api/projects", { headers: { host: TEST_REMOTE_HOST } })).status).toBe(403);
  });

  it("sends the security headers on a refusal, with the preview public origin in frame-src", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    const response = await sendRequest(app, "/api/projects", { headers: { host: "evil.example" } });
    expect(response.status).toBe(403);
    const csp = response.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`frame-src http://127.0.0.1:4318 ${TEST_REMOTE.previewOrigin};`);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("leaves frame-src loopback-only when remote mode is off", async () => {
    const { app } = buildGuardedApp();
    const csp = (await sendRequest(app, "/")).headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-src http://127.0.0.1:4318;");
  });
});

describe("the terminal WebSocket guard in remote mode", () => {
  const publicHeaders = { host: TEST_REMOTE_HOST, origin: PUBLIC_ORIGIN, "sec-fetch-site": "same-origin", [PROXY_SECRET_HEADER]: TEST_REMOTE.proxySecret };

  it("accepts the public host with its exact https Origin and a fresh ticket", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket, publicHeaders), tickets)).toEqual({ ok: true });
  });

  it.each([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["an http Origin for the public host", { origin: `http://${TEST_REMOTE_HOST}` }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
  ])("refuses %s and leaves the ticket unspent", (_label, overrides) => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket, { ...publicHeaders, ...overrides }), tickets)).toMatchObject({ ok: false, status: 403 });
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
  });

  it("refuses the public host when remote mode is off", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    const result = checkWebSocketUpgrade(upgradeRequest(ticket, publicHeaders), {
      allowedHosts: allowedHostsFor(TEST_APP_PORT),
      tickets,
      sessionId: SESSION_ID,
    });
    expect(result).toMatchObject({ ok: false, status: 403, reason: "host" });
  });
});

describe("proof that the peer is the proxy", () => {
  const publicRead = { host: TEST_REMOTE_HOST };

  it.each([
    ["no secret", {}],
    ["a wrong secret", { [PROXY_SECRET_HEADER]: "x".repeat(40) }],
    ["a secret of another length", { [PROXY_SECRET_HEADER]: "short" }],
  ])("refuses a non-loopback peer with %s, whatever the Host", async (_label, proof) => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    for (const host of [TEST_REMOTE_HOST, TEST_APP_HOST, "evil.example"]) {
      const response = await sendBare(app, "/api/projects", { peer: OTHER_CONTAINER_PEER, headers: { host, ...proof } });
      expect(response.status).toBe(403);
    }
    const refusal = await sendBare(app, "/api/projects", { peer: OTHER_CONTAINER_PEER, headers: { ...publicRead, ...proof } });
    expect(await refusal.json()).toEqual({ error: "Forbidden: proxy" });
    expect(refusal.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });

  it("refuses a request whose peer address is unknown and carries no secret", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    expect((await sendBare(app, "/api/projects", { headers: publicRead })).status).toBe(403);
  });

  it("does not hand the CSRF token to a peer without proof", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    const response = await sendBare(app, "/api/projects", { peer: OTHER_CONTAINER_PEER, headers: publicRead });
    expect(response.headers.get(CSRF_HEADER)).toBeNull();
  });

  it("passes the right secret from a non-loopback peer", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    const headers = { ...publicRead, [PROXY_SECRET_HEADER]: TEST_REMOTE.proxySecret };
    expect((await sendBare(app, "/api/projects", { peer: OTHER_CONTAINER_PEER, headers })).status).toBe(200);
  });

  it.each(["127.0.0.1", "::1", "::ffff:127.0.0.1"])("passes a loopback peer %s with no secret, for the healthcheck", async (peer) => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    expect((await sendBare(app, "/", { peer, headers: { host: TEST_APP_HOST } })).status).toBe(200);
  });

  it("keeps the other guards after the proof: a loopback peer still needs Origin and CSRF on writes", async () => {
    const { app } = buildGuardedApp(TEST_REMOTE);
    const response = await sendBare(app, "/api/rules", { method: "POST", peer: "127.0.0.1", headers: { host: TEST_APP_HOST }, body: "{}" });
    expect(response.status).toBe(403);
  });

  it("ignores the secret when remote mode is off", async () => {
    const { app } = buildGuardedApp();
    expect((await sendBare(app, "/api/projects", { peer: OTHER_CONTAINER_PEER })).status).toBe(200);
  });
});

describe("the WebSocket upgrade needs the same proof", () => {
  const headers = { host: TEST_REMOTE_HOST, origin: PUBLIC_ORIGIN, "sec-fetch-site": "same-origin" };
  const check = (proof: Record<string, string | undefined>, peerAddress: string | undefined) => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    const options = { allowedHosts: allowedHostsFor(TEST_APP_PORT, TEST_REMOTE), tickets, sessionId: SESSION_ID, remote: TEST_REMOTE, peerAddress };
    return { result: checkWebSocketUpgrade(upgradeRequest(ticket, { ...headers, ...proof }), options), tickets, ticket };
  };

  it("refuses a non-loopback peer with no or a wrong secret, leaving the ticket unspent", () => {
    for (const proof of [{}, { [PROXY_SECRET_HEADER]: "x".repeat(40) }]) {
      const { result, tickets, ticket } = check(proof, OTHER_CONTAINER_PEER);
      expect(result).toMatchObject({ ok: false, status: 403, reason: "proxy" });
      expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
    }
  });

  it("accepts the right secret", () => {
    expect(check({ [PROXY_SECRET_HEADER]: TEST_REMOTE.proxySecret }, OTHER_CONTAINER_PEER).result).toEqual({ ok: true });
  });
});
