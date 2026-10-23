// Created by The Angelo Umali.
import { CSRF_HEADER, TerminalTicketSchema } from "@zks/shared";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { TerminalSession } from "../../src/terminal/terminal-sessions.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, waitFor } from "./stub-claude.ts";
import { PROJECT_ID, type TerminalFixture } from "./terminal-fixture.ts";
import { startTerminalServer, type TerminalServer } from "./terminal-server.ts";

const UNKNOWN_SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";
const FOREIGN_ORIGIN = "http://evil.example";

let terminalServer: TerminalServer;
let fixture: TerminalFixture;
let baseUrl: string;

afterEach(async () => {
  await terminalServer.close();
});

async function startServer(): Promise<void> {
  terminalServer = await startTerminalServer();
  ({ fixture, baseUrl } = terminalServer);
}

async function openSession(): Promise<TerminalSession> {
  return fixture.sessions.open({ projectId: PROJECT_ID, projectDir: fixture.projectDir, model: "haiku", rulesText: "rules" });
}

async function issueTicket(sessionId: string): Promise<Response> {
  return fetch(`${baseUrl}/api/terminal/${sessionId}/ticket`, {
    method: "POST",
    headers: { origin: baseUrl, "content-type": "application/json", [CSRF_HEADER]: terminalServer.csrfToken },
  });
}

async function ticketFor(sessionId: string): Promise<string> {
  return TerminalTicketSchema.parse(await (await issueTicket(sessionId)).json()).ticket;
}

interface UpgradeHeaders {
  readonly origin?: string | null;
  readonly fetchSite?: string | null;
}

async function connectSocket(sessionId: string, ticket: string, headers: UpgradeHeaders = {}): Promise<{ socket: WebSocket; received: string[] }> {
  const fetchSite = headers.fetchSite === undefined ? "same-origin" : headers.fetchSite;
  const origin = headers.origin === undefined ? baseUrl : headers.origin;
  const upgradeHeaders = { ...(origin === null ? {} : { origin }), ...(fetchSite === null ? {} : { "sec-fetch-site": fetchSite }) };
  const socket = new WebSocket(`${baseUrl.replace("http", "ws")}/api/terminal/${sessionId}/ws?ticket=${ticket}`, { headers: upgradeHeaders });
  const received: string[] = [];
  socket.on("message", (frame: Buffer) => received.push(frame.toString("utf8")));
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("unexpected-response", (_request, response) => reject(new Error(`upgrade refused ${response.statusCode}`)));
    socket.once("error", reject);
  });
  return { socket, received };
}

function postHook(sessionId: string, body: unknown, bearer: string | undefined): Promise<Response> {
  const authorization = bearer === undefined ? {} : { authorization: `Bearer ${bearer}` };
  return fetch(`${baseUrl}/api/terminal/${sessionId}/hooks`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authorization },
    body: JSON.stringify(body),
  });
}

describe("terminal routes", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("issues a WebSocket ticket only for a live session", async () => {
    await startServer();
    const session = await openSession();
    expect((await issueTicket(UNKNOWN_SESSION_ID)).status).toBe(404);
    const ticketResponse = await issueTicket(session.sessionId);
    expect(ticketResponse.status).toBe(200);
    expect(TerminalTicketSchema.safeParse(await ticketResponse.json()).success).toBe(true);
  });

  it("refuses a ticket POST without the CSRF token", async () => {
    await startServer();
    const session = await openSession();
    const response = await fetch(`${baseUrl}/api/terminal/${session.sessionId}/ticket`, {
      method: "POST",
      headers: { origin: baseUrl, "content-type": "application/json" },
    });
    expect(response.status).toBe(403);
  });

  it("refuses an upgrade without a ticket, from another origin, or with cross-site fetch metadata", async () => {
    await startServer();
    const session = await openSession();
    await expect(connectSocket(session.sessionId, "not-a-ticket")).rejects.toThrow("upgrade refused 403");
    await expect(connectSocket(session.sessionId, await ticketFor(session.sessionId), { origin: FOREIGN_ORIGIN })).rejects.toThrow("upgrade refused 403");
    await expect(connectSocket(session.sessionId, await ticketFor(session.sessionId), { fetchSite: "cross-site" })).rejects.toThrow("upgrade refused 403");
  });

  // The request middleware lets these through on a GET, so only the socket guard stands between them and the PTY.
  it("refuses an upgrade with no Origin, or with same-site or none fetch metadata", async () => {
    await startServer();
    const session = await openSession();
    for (const headers of [{ origin: null, fetchSite: null }, { fetchSite: "same-site" }, { fetchSite: "none" }]) {
      await expect(connectSocket(session.sessionId, await ticketFor(session.sessionId), headers), JSON.stringify(headers)).rejects.toThrow(
        "upgrade refused 403",
      );
    }
  });

  // Chrome's WebSocket handshake carries Host and Origin but no Sec-Fetch-* headers.
  it("accepts a browser-shaped upgrade that sends no fetch metadata", async () => {
    await startServer();
    const session = await openSession();
    const { socket } = await connectSocket(session.sessionId, await ticketFor(session.sessionId), { fetchSite: null });
    socket.close();
  });

  it("refuses a reused ticket and a ticket issued for another session", async () => {
    await startServer();
    const session = await openSession();
    const otherSession = await openSession();
    const ticket = await ticketFor(session.sessionId);
    const { socket } = await connectSocket(session.sessionId, ticket);
    socket.close();
    await expect(connectSocket(session.sessionId, ticket)).rejects.toThrow("upgrade refused 403");
    await expect(connectSocket(otherSession.sessionId, await ticketFor(session.sessionId))).rejects.toThrow("upgrade refused 403");
  });

  it("replays the screen, carries keystrokes, and leaves the PTY running when the tab closes", async () => {
    await startServer();
    const session = await openSession();
    await waitFor(() => session.pty.snapshot().includes("READY"));
    const { socket, received } = await connectSocket(session.sessionId, await ticketFor(session.sessionId));

    await waitFor(() => received.join("").includes("READY"));
    socket.send(JSON.stringify({ type: "resize", cols: 100, rows: 30 }));
    socket.send(JSON.stringify({ type: "input", data: "y" }));
    await waitFor(() => received.join("").includes('GOT "y"'));

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(fixture.sessions.find(session.sessionId)).toBe(session);
  });

  it("refuses hooks without the session's bearer token or with a malformed payload", async () => {
    await startServer();
    const session = await openSession();
    const payload = { session_id: session.sessionId, hook_event_name: "Notification", message: "waiting" };
    expect((await postHook(session.sessionId, payload, undefined)).status).toBe(401);
    expect((await postHook(session.sessionId, payload, "forged")).status).toBe(401);
    expect((await postHook(UNKNOWN_SESSION_ID, payload, session.hookToken)).status).toBe(401);
    expect((await postHook(session.sessionId, { hook_event_name: "Nope" }, session.hookToken)).status).toBe(400);
  });

  it("relays SessionStart from the PTY to the bridge, then denies Bash over the same bridge", async () => {
    await startServer();
    const session = await openSession();
    await waitFor(() => session.pty.snapshot().includes("RELAY"));
    expect(session.pty.snapshot()).toContain('RELAY {"code":0');
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "session.started", projectId: PROJECT_ID }));
    expect(fixture.sessions.isMcpCallAllowed(session.sessionId, session.mcpToken)).toBe(true);

    session.pty.write("TOOL Bash");
    await waitFor(() => session.pty.snapshot().includes("DECISION"));
    expect(session.pty.snapshot()).toContain('"permissionDecision":"deny"');
    expect(fixture.events).toContainEqual(expect.objectContaining({ type: "tool.denied", name: "Bash" }));
  });
});
