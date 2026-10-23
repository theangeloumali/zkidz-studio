// Created by The Angelo Umali.
import { TERMINAL_TICKET_TTL_S } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { allowedHostsFor } from "../../src/security/request-guards.ts";
import { checkWebSocketUpgrade, createTicketStore, type TicketStore } from "../../src/security/ws-guard.ts";
import { TEST_APP_HOST, TEST_APP_ORIGIN, TEST_APP_PORT, TEST_PREVIEW_PORT, type HeaderOverrides } from "./test-app.ts";

const SESSION_ID = "session-1";
const OTHER_SESSION_ID = "session-2";
const TTL_MS = TERMINAL_TICKET_TTL_S * 1000;

function createClock(startMs = Date.UTC(2026, 9, 23)) {
  let currentMs = startMs;
  return { now: () => currentMs, advance: (elapsedMs: number) => (currentMs += elapsedMs) };
}

function upgradeRequest(ticket: string | undefined, headerOverrides: HeaderOverrides = {}): Request {
  const headers = Object.entries({ host: TEST_APP_HOST, origin: TEST_APP_ORIGIN, "sec-fetch-site": "same-origin", ...headerOverrides }).filter(
    (entry): entry is [string, string] => entry[1] !== undefined,
  );
  const query = ticket === undefined ? "" : `?ticket=${encodeURIComponent(ticket)}`;
  return new Request(`${TEST_APP_ORIGIN}/api/terminal/${SESSION_ID}/ws${query}`, { headers });
}

function checkUpgrade(request: Request, tickets: TicketStore, sessionId = SESSION_ID) {
  return checkWebSocketUpgrade(request, { allowedHosts: allowedHostsFor(TEST_APP_PORT), tickets, sessionId });
}

describe("createTicketStore", () => {
  it("issues a ticket of at least 32 characters with its ISO expiry", () => {
    const clock = createClock();
    const issued = createTicketStore({ now: clock.now }).issue(SESSION_ID);
    expect(issued.ticket.length).toBeGreaterThanOrEqual(32);
    expect(issued.expiresAt).toBe(new Date(clock.now() + TTL_MS).toISOString());
  });

  it("redeems a ticket once, for its own session only", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(false);
  });

  it("burns a ticket presented for another session", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(tickets.redeem(ticket, OTHER_SESSION_ID)).toBe(false);
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(false);
  });

  it("honours the 30 s TTL by default and an injected TTL", () => {
    const clock = createClock();
    const defaultTickets = createTicketStore({ now: clock.now });
    const shortTickets = createTicketStore({ now: clock.now, ttlMs: 1000 });
    const lastValid = defaultTickets.issue(SESSION_ID).ticket;
    const expiredDefault = defaultTickets.issue(SESSION_ID).ticket;
    const expiredShort = shortTickets.issue(SESSION_ID).ticket;
    clock.advance(TTL_MS - 1);
    expect(defaultTickets.redeem(lastValid, SESSION_ID)).toBe(true);
    expect(shortTickets.redeem(expiredShort, SESSION_ID)).toBe(false);
    clock.advance(1);
    expect(defaultTickets.redeem(expiredDefault, SESSION_ID)).toBe(false);
  });

  it("rejects a ticket it never issued", () => {
    expect(createTicketStore().redeem("x".repeat(43), SESSION_ID)).toBe(false);
  });
});

describe("checkWebSocketUpgrade", () => {
  it("accepts the app's own same-origin upgrade with a fresh ticket", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket), tickets)).toEqual({ ok: true });
  });

  it.each<[string, HeaderOverrides]>([
    ["a foreign Origin", { origin: "https://evil.example" }],
    ["the preview Origin", { origin: `http://127.0.0.1:${TEST_PREVIEW_PORT}` }],
    ["an opaque null Origin", { origin: "null" }],
    ["missing Origin", { origin: undefined }],
    ["a wrong Host", { host: "evil.example:4317" }],
    ["a rebinding Host on another port", { host: `127.0.0.1:${TEST_PREVIEW_PORT}` }],
    ["missing Host", { host: undefined }],
    ["Sec-Fetch-Site cross-site", { "sec-fetch-site": "cross-site" }],
    ["Sec-Fetch-Site same-site", { "sec-fetch-site": "same-site" }],
    ["Sec-Fetch-Site none", { "sec-fetch-site": "none" }],
  ])("refuses %s with 403 and leaves the ticket unspent", (_label, headerOverrides) => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    const result = checkUpgrade(upgradeRequest(ticket, headerOverrides), tickets);
    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
  });

  // Chrome sends no Sec-Fetch-* headers on a WebSocket handshake (logged from Chrome 155 and 156); Origin is what it always sends.
  it("accepts a real browser handshake: Host, exact Origin and a fresh ticket, with no Sec-Fetch-Site", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket, { "sec-fetch-site": undefined }), tickets)).toEqual({ ok: true });
  });

  it("still refuses a handshake with no Sec-Fetch-Site when the Origin is foreign or missing", () => {
    for (const origin of ["https://evil.example", undefined]) {
      const tickets = createTicketStore();
      const { ticket } = tickets.issue(SESSION_ID);
      expect(checkUpgrade(upgradeRequest(ticket, { "sec-fetch-site": undefined, origin }), tickets)).toMatchObject({
        ok: false,
        status: 403,
        reason: "origin",
      });
      expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
    }
  });

  // The HTTP write check accepts the app on localhost and [::1] too; the socket must follow the same host-bound rule.
  it("accepts the app opened on localhost, whose Origin matches its Host", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    const host = `localhost:${TEST_APP_PORT}`;
    expect(checkUpgrade(upgradeRequest(ticket, { host, origin: `http://${host}`, "sec-fetch-site": undefined }), tickets)).toEqual({ ok: true });
  });

  it("refuses an Origin that names a different allowed host than the request's Host", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    const result = checkUpgrade(upgradeRequest(ticket, { host: `localhost:${TEST_APP_PORT}`, origin: TEST_APP_ORIGIN }), tickets);
    expect(result).toMatchObject({ ok: false, status: 403, reason: "origin" });
    expect(tickets.redeem(ticket, SESSION_ID)).toBe(true);
  });

  it("refuses a missing ticket", () => {
    expect(checkUpgrade(upgradeRequest(undefined), createTicketStore())).toEqual({ ok: false, status: 403, reason: "ticket" });
  });

  it("refuses an expired ticket", () => {
    const clock = createClock();
    const tickets = createTicketStore({ now: clock.now });
    const { ticket } = tickets.issue(SESSION_ID);
    clock.advance(TTL_MS);
    expect(checkUpgrade(upgradeRequest(ticket), tickets)).toEqual({ ok: false, status: 403, reason: "ticket" });
  });

  it("refuses a reused ticket", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket), tickets)).toEqual({ ok: true });
    expect(checkUpgrade(upgradeRequest(ticket), tickets)).toEqual({ ok: false, status: 403, reason: "ticket" });
  });

  it("refuses a ticket issued for another session", () => {
    const tickets = createTicketStore();
    const { ticket } = tickets.issue(OTHER_SESSION_ID);
    expect(checkUpgrade(upgradeRequest(ticket), tickets)).toEqual({ ok: false, status: 403, reason: "ticket" });
  });
});
