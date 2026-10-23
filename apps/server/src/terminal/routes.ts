// Created by The Angelo Umali.
// Mode T HTTP surface (plan §6.3): WS ticket, the ticketed terminal socket, and the hooks bridge.
import { upgradeWebSocket } from "@hono/node-server";
import { API_ROUTES, HookPayloadSchema } from "@zks/shared";
import type { Hono } from "hono";
import type { WSContext } from "hono/ws";
import { z } from "zod";
import { HttpError, notFound, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import type { TicketStore, WebSocketUpgradeOptions, WebSocketUpgradeResult } from "../security/ws-guard.ts";
import type { TerminalSession, TerminalSessions } from "./terminal-sessions.ts";

const MAX_INPUT_CHARS = 64 * 1024;
const MAX_TERMINAL_CELLS = 1000;
const BEARER_PREFIX = "Bearer ";

export interface TerminalRouteDeps {
  readonly sessions: Pick<TerminalSessions, "find" | "isHookAuthorized" | "handleHook">;
  readonly tickets: TicketStore;
  readonly checkWebSocketUpgrade: (request: Request, options: WebSocketUpgradeOptions) => WebSocketUpgradeResult;
  readonly allowedHosts: readonly string[];
  readonly allowedOrigin: string;
  readonly logger: Logger;
}

const TerminalSize = z.int().min(1).max(MAX_TERMINAL_CELLS);
const TerminalClientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("input"), data: z.string().max(MAX_INPUT_CHARS) }),
  z.strictObject({ type: z.literal("resize"), cols: TerminalSize, rows: TerminalSize }),
]);

export function registerTerminalRoutes(app: Hono, deps: TerminalRouteDeps): void {
  const findSession = (sessionId: string) => {
    const session = deps.sessions.find(sessionId);
    if (session === undefined) throw notFound();
    return session;
  };

  app.post(API_ROUTES.terminalTicket.path, (c) => {
    const { sessionId } = findSession(c.req.param("sessionId"));
    return c.json(deps.tickets.issue(sessionId));
  });

  app.get(
    API_ROUTES.terminalSocket.path,
    async (c, next) => {
      const { sessionId } = findSession(c.req.param("sessionId"));
      const verdict = deps.checkWebSocketUpgrade(c.req.raw, {
        allowedHosts: deps.allowedHosts,
        allowedOrigin: deps.allowedOrigin,
        tickets: deps.tickets,
        sessionId,
      });
      if (!verdict.ok) {
        deps.logger.warn("terminal socket refused", { reason: verdict.reason });
        return c.json({ error: "Forbidden" }, verdict.status);
      }
      await next();
    },
    upgradeWebSocket((c) => bridgeSocket(findSession(c.req.param("sessionId") ?? ""), deps.logger)),
  );

  app.post(API_ROUTES.terminalHooks.path, async (c) => {
    const sessionId = c.req.param("sessionId");
    const authorization = c.req.header("authorization");
    const presentedToken = authorization?.startsWith(BEARER_PREFIX) ? authorization.slice(BEARER_PREFIX.length) : undefined;
    // Unknown session and wrong token answer alike, so the bridge does not reveal which sessions exist.
    if (!deps.sessions.isHookAuthorized(sessionId, presentedToken)) throw new HttpError(401, "Unauthorized");
    const payload = parseOrBadRequest(HookPayloadSchema, await readJsonBody(c));
    return c.json(await deps.sessions.handleHook(sessionId, payload));
  });
}

function bridgeSocket(session: TerminalSession, logger: Logger) {
  const unsubscribers: (() => void)[] = [];
  return {
    onOpen(_event: Event, socket: WSContext) {
      socket.send(session.pty.snapshot());
      unsubscribers.push(
        session.pty.onData((output) => socket.send(output)),
        session.pty.onExit(() => socket.close(1000, "terminal exited")),
      );
    },
    onMessage(event: MessageEvent, _socket: WSContext) {
      const parsed = typeof event.data === "string" ? TerminalClientMessageSchema.safeParse(parseJson(event.data)) : undefined;
      if (parsed?.success !== true) return logger.warn("terminal socket message ignored");
      if (parsed.data.type === "input") session.pty.write(parsed.data.data);
      else session.pty.resize(parsed.data.cols, parsed.data.rows);
    },
    // Closing the tab only detaches; the PTY keeps running until Kill (plan §6.3).
    onClose() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
    },
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
