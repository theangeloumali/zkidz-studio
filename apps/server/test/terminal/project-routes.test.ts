// Created by The Angelo Umali.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { agentSessions, projects, rules } from "@zks/db/schema";
import { API_ROUTES } from "@zks/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerAgentRoutes } from "../../src/agent/routes.ts";
import { writeConnection } from "../../src/auth/connection-store.ts";
import { errorBody, toHttpError } from "../../src/http/http-error.ts";
import { createProjectTerminalOpener, registerProjectTerminalRoutes } from "../../src/terminal/project-routes.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, stubReport, waitFor } from "./stub-claude.ts";
import { createTerminalFixture, type TerminalFixture } from "./terminal-fixture.ts";

let fixture: TerminalFixture;
let database: StudioDatabaseHandle;
let app: Hono;
let projectId = "";
let sdkCalls: string[];

const post = (path: string, body: unknown = null) =>
  app.request(`/api/projects/${projectId}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const openTerminal = async (body: unknown = null) => {
  const response = await app.request(API_ROUTES.openTerminal.path.replace(":projectId", projectId), {
    method: API_ROUTES.openTerminal.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json();
  const parsed = API_ROUTES.openTerminal.response.safeParse(json);
  return { status: response.status, body: parsed.success ? parsed.data : (json as { sessionId?: string }) };
};
const startSession = (sessionId: string) =>
  fixture.sessions.handleHook(sessionId, { session_id: sessionId, hook_event_name: "SessionStart", permission_mode: "default" });
const liveSession = (sessionId: string | undefined) => {
  const session = fixture.sessions.find(sessionId ?? "");
  if (session === undefined) throw new Error(`no live terminal ${sessionId}`);
  return session;
};

beforeEach(async () => {
  fixture = await createTerminalFixture();
  database = await openDatabase({ dataDir: join(fixture.studioHome, "db") });
  await database.migrate();
  const [project] = await database.db.insert(projects).values({ slug: "demo", title: "Demo" }).returning();
  projectId = project?.id ?? "";
  sdkCalls = [];
  const recordSdkCall = (name: string) => () => Promise.resolve(void sdkCalls.push(name));
  const sdkManager = { submit: recordSdkCall("submit"), stop: recordSdkCall("stop"), kill: recordSdkCall("kill"), decide: () => false };

  app = new Hono();
  const openProjectTerminal = createProjectTerminalOpener({
    database: database.db,
    studioHome: fixture.studioHome,
    model: "haiku",
    sessions: fixture.sessions,
  });
  registerAgentRoutes(app, { database: database.db, manager: sdkManager, terminal: { sessions: fixture.sessions, open: openProjectTerminal } });
  registerProjectTerminalRoutes(app, { database: database.db, openTerminal: openProjectTerminal });
  app.onError((error, c) => {
    const httpError = toHttpError(error);
    return c.json(errorBody(httpError), httpError.status);
  });
});

afterEach(async () => {
  await database.close();
  await fixture.cleanup();
});

describe("project terminal routes", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("answers the shared openTerminal contract with the live session's id", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    const opened = await openTerminal();

    expect(opened.status).toBe(200);
    expect(API_ROUTES.openTerminal.response.parse(opened.body)).toEqual({ sessionId: liveSession(opened.body.sessionId).sessionId });
  });

  it("refuses to open a terminal until mode T is connected, and 404s an unknown project", async () => {
    expect((await openTerminal()).status).toBe(409);
    await writeConnection(database.db, { mode: "api_key", keyLast4: "abcd" });
    expect((await openTerminal()).status).toBe(409);
    expect(fixture.sessions.findByProject(projectId)).toBeUndefined();

    await writeConnection(database.db, { mode: "terminal" });
    const unknown = await app.request(`/api/projects/${crypto.randomUUID()}/terminal`, { method: "POST" });
    expect(unknown.status).toBe(404);
  });

  it("opens in the project's own folder with the user's rules, ignoring a body that names a folder or session", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    await database.db.insert(rules).values([{ text: "Keep cuts under 60 s" }, { text: "Disabled rule", enabled: false }]);

    const opened = await openTerminal({ projectDir: "/", resumeSessionId: crypto.randomUUID() });
    expect(opened.status).toBe(200);
    const session = liveSession(opened.body.sessionId);
    await waitFor(() => session.pty.snapshot().includes("READY"));

    const report = stubReport(session);
    expect(report.argv.slice(0, 2)).toEqual(["--session-id", session.sessionId]);
    expect(report.cwd).toBe(join(fixture.studioHome, "projects", "demo"));
    const rulesText = await readFile(report.argv[report.argv.indexOf("--append-system-prompt-file") + 1] ?? "", "utf8");
    expect(rulesText).toContain("Keep cuts under 60 s");
    expect(rulesText).not.toContain("Disabled rule");
    expect(await database.db.select().from(agentSessions)).toEqual([
      expect.objectContaining({ projectId, sdkSessionId: session.sessionId, authMode: "terminal", model: "haiku", status: "active" }),
    ]);
  });

  it("reattaches to the live PTY instead of starting a second one, even when two opens race", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    const [first, second] = await Promise.all([openTerminal(), openTerminal()]);
    const third = await openTerminal();

    expect(first.body.sessionId).toBeDefined();
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(third.body.sessionId).toBe(first.body.sessionId);
  });

  it("routes prompt, stop and kill to the PTY in mode T, and a reopen resumes the same conversation", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    const first = liveSession((await openTerminal()).body.sessionId);
    await waitFor(() => first.pty.snapshot().includes("READY"));
    await startSession(first.sessionId);

    expect((await post("prompt", { text: "Make a cut" })).status).toBe(200);
    await waitFor(() => first.pty.snapshot().includes("Make a cut"));
    expect((await post("stop")).status).toBe(200);
    await waitFor(() => first.pty.snapshot().includes("INTERRUPTED"));
    expect((await post("kill")).status).toBe(200);
    await waitFor(() => fixture.sessions.findByProject(projectId) === undefined);

    const reopened = liveSession((await openTerminal()).body.sessionId);
    await waitFor(() => reopened.pty.snapshot().includes("READY"));
    expect(stubReport(reopened).argv.slice(0, 2)).toEqual(["--resume", first.sessionId]);
    expect(sdkCalls).toEqual([]);
  });

  it("opens the project's terminal for a prompt in mode T and sends the prompt once the session has started", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    expect((await post("prompt", { text: "Make a cut" })).status).toBe(200);
    const session = liveSession(fixture.sessions.findByProject(projectId)?.sessionId);
    await waitFor(() => session.pty.snapshot().includes("READY"));
    expect(stubReport(session).cwd).toBe(join(fixture.studioHome, "projects", "demo"));
    session.pty.write("MARKER");
    await waitFor(() => session.pty.snapshot().includes("MARKER"));
    expect(session.pty.snapshot()).not.toContain("Make a cut");

    await startSession(session.sessionId);
    await waitFor(() => session.pty.snapshot().includes("Make a cut"));
    expect((await openTerminal()).body.sessionId).toBe(session.sessionId);
    expect(sdkCalls).toEqual([]);
  });

  it("opens one terminal when a prompt and the Terminal tab race", async () => {
    await writeConnection(database.db, { mode: "terminal" });
    const [prompted, opened] = await Promise.all([post("prompt", { text: "Make a cut" }), openTerminal()]);

    expect(prompted.status).toBe(200);
    expect(opened.body.sessionId).toBe(fixture.sessions.findByProject(projectId)?.sessionId);
    expect(await database.db.select().from(agentSessions)).toHaveLength(1);
  });
});
