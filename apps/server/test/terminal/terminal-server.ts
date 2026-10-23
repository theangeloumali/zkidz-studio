// Created by The Angelo Umali.
// A real HTTP + WebSocket server with the terminal routes over a TerminalFixture, behind kai's real guards.
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { WebSocketServer } from "ws";
import { errorBody, toHttpError } from "../../src/http/http-error.ts";
import { allowedHostsFor, createRequestGuard } from "../../src/security/request-guards.ts";
import { createSessionToken } from "../../src/security/token.ts";
import { checkWebSocketUpgrade, createTicketStore } from "../../src/security/ws-guard.ts";
import { registerTerminalRoutes } from "../../src/terminal/routes.ts";
import type { TerminalSessionsDeps } from "../../src/terminal/terminal-sessions.ts";
import { createTerminalFixture, type TerminalFixture, type TerminalFixtureOptions } from "./terminal-fixture.ts";

const UNUSED_PREVIEW_PORT = 9;

export interface TerminalServer {
  readonly fixture: TerminalFixture;
  readonly baseUrl: string;
  /** The CSRF token the guard expects on browser writes such as the ticket POST. */
  readonly csrfToken: string;
  readonly close: () => Promise<void>;
}

export async function startTerminalServer(
  fixtureOptions: TerminalFixtureOptions = {},
  depOverrides: Partial<TerminalSessionsDeps> = {},
  /** Mounts more of the app (connect, project and agent routes) over the same fixture. */
  mountRoutes: (app: Hono, fixture: TerminalFixture) => void = () => undefined,
): Promise<TerminalServer> {
  const app = new Hono();
  app.onError((error, c) => {
    const httpError = toHttpError(error);
    return c.json(errorBody(httpError), httpError.status);
  });
  const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1", websocket: { server: new WebSocketServer({ noServer: true }) } });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const csrfToken = createSessionToken();
  const requestGuard = createRequestGuard({ appPort: port, previewPort: UNUSED_PREVIEW_PORT, csrfToken });
  app.use("/api/*", requestGuard);
  // The relay posts SessionStart to the real port, so the sessions need it before the routes go live.
  const fixture = await createTerminalFixture({ ...depOverrides, appPort: port }, fixtureOptions);
  registerTerminalRoutes(app, {
    sessions: fixture.sessions,
    tickets: createTicketStore(),
    checkWebSocketUpgrade,
    allowedHosts: allowedHostsFor(port),
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  });
  mountRoutes(app, fixture);

  return {
    fixture,
    baseUrl,
    csrfToken,
    async close() {
      await fixture.cleanup();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
