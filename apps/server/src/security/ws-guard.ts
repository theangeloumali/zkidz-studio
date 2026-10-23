// Created by The Angelo Umali.
// Mode T WebSocket upgrade guard (plan §6.3, §11): Host, exact Origin, same-origin fetch metadata, single-use ticket.
import { TERMINAL_TICKET_TTL_S } from "@zks/shared";
import { isAllowedHost } from "./request-guards.ts";
import { createSessionToken } from "./token.ts";

export interface TicketStoreOptions {
  readonly ttlMs?: number;
  /** Injectable clock for tests; epoch milliseconds. */
  readonly now?: () => number;
}

interface IssuedTicket {
  readonly ticket: string;
  readonly expiresAt: string;
}

export interface TicketStore {
  issue(sessionId: string): IssuedTicket;
  /** True once per ticket, for the session it was issued to, before it expires. */
  redeem(ticket: string, sessionId: string): boolean;
}

export interface WebSocketUpgradeOptions {
  readonly allowedHosts: readonly string[];
  readonly allowedOrigin: string;
  readonly tickets: TicketStore;
  readonly sessionId: string;
}

export type WebSocketUpgradeResult = { readonly ok: true } | { readonly ok: false; readonly status: 403; readonly reason: string };

interface PendingTicket {
  readonly sessionId: string;
  readonly expiresAtMs: number;
}

export function createTicketStore(options: TicketStoreOptions = {}): TicketStore {
  const ttlMs = options.ttlMs ?? TERMINAL_TICKET_TTL_S * 1000;
  const now = options.now ?? Date.now;
  const pendingTickets = new Map<string, PendingTicket>();

  return {
    issue(sessionId) {
      dropExpired(pendingTickets, now());
      const ticket = createSessionToken();
      const expiresAtMs = now() + ttlMs;
      pendingTickets.set(ticket, { sessionId, expiresAtMs });
      return { ticket, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    redeem(ticket, sessionId) {
      const pendingTicket = pendingTickets.get(ticket);
      // Deleted on any presentation, so a ticket aimed at the wrong session is spent too.
      pendingTickets.delete(ticket);
      return pendingTicket !== undefined && pendingTicket.sessionId === sessionId && now() < pendingTicket.expiresAtMs;
    },
  };
}

export function checkWebSocketUpgrade(request: Request, options: WebSocketUpgradeOptions): WebSocketUpgradeResult {
  const reason = findUpgradeRejection(request, options);
  return reason === null ? { ok: true } : { ok: false, status: 403, reason };
}

// Header checks run before redeem so a refused upgrade cannot spend the app's own ticket.
function findUpgradeRejection(request: Request, options: WebSocketUpgradeOptions): string | null {
  if (!isAllowedHost(request.headers.get("host") ?? undefined, options.allowedHosts)) return "host";
  if (request.headers.get("origin") !== options.allowedOrigin) return "origin";
  // Stricter than HTTP reads: "none" and an absent header are refused, since only the app's own page opens this socket.
  if (request.headers.get("sec-fetch-site")?.toLowerCase() !== "same-origin") return "fetch-site";
  const ticket = new URL(request.url).searchParams.get("ticket");
  if (ticket === null || !options.tickets.redeem(ticket, options.sessionId)) return "ticket";
  return null;
}

function dropExpired(pendingTickets: Map<string, PendingTicket>, nowMs: number): void {
  for (const [ticket, pendingTicket] of pendingTickets) {
    if (nowMs >= pendingTicket.expiresAtMs) pendingTickets.delete(ticket);
  }
}
