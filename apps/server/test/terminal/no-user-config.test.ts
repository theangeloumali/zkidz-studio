// Created by The Angelo Umali.
// Mode T AC (plan §6.3): the server never opens, stats or lists anything under ~/.claude or ~/.claude.json.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { projects } from "@zks/db/schema";
import { CSRF_HEADER } from "@zks/shared";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { registerAgentRoutes } from "../../src/agent/routes.ts";
import { registerConnectRoutes } from "../../src/auth/routes.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { registerProjectTerminalRoutes } from "../../src/terminal/project-routes.ts";
import { memoryKeyring } from "../auth/memory-keyring.ts";
import { REAL_PTY_TEST_TIMEOUT_MS, waitFor } from "./stub-claude.ts";
import { startTerminalServer, type TerminalServer } from "./terminal-server.ts";

const touchedPaths = vi.hoisted(() => [] as string[]);

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { recordingFs } = await import("./recording-fs.ts");
  const spied = recordingFs(actual, ["open", "readFile", "stat", "lstat", "realpath", "access", "readdir", "opendir"], touchedPaths);
  return { ...spied, default: spied };
});
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { recordingFs } = await import("./recording-fs.ts");
  const names = ["open", "openSync", "readFile", "readFileSync", "stat", "statSync", "lstatSync", "realpathSync", "access", "accessSync", "existsSync"];
  const spied = recordingFs(actual, [...names, "readdir", "readdirSync", "createReadStream"], touchedPaths);
  return { ...spied, default: spied };
});

let fakeHome = "";
let originalHome: string | undefined;
let server: TerminalServer;
let database: StudioDatabaseHandle;
let projectId = "";

beforeAll(async () => {
  originalHome = process.env.HOME;
  fakeHome = await mkdtemp(join(tmpdir(), "zks-home-"));
  await mkdir(join(fakeHome, ".claude"));
  await writeFile(join(fakeHome, ".claude", ".credentials.json"), '{"claudeAiOauth":{}}');
  await writeFile(join(fakeHome, ".claude", "settings.json"), "{}");
  await writeFile(join(fakeHome, ".claude.json"), "{}");
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;

  database = await openDatabase({ dataDir: await mkdtemp(join(tmpdir(), "zks-db-")) });
  await database.migrate();
  server = await startTerminalServer({}, {}, (app, fixture) => {
    registerConnectRoutes(app, {
      database: database.db,
      secretStore: createSecretStore({ studioHome: fixture.studioHome, platform: "linux", keyring: memoryKeyring(), readMounts: () => Promise.resolve("") }),
      fetch: () => Promise.resolve(new Response("{}", { status: 200 })),
      logger: createLogger(() => undefined),
      claudeVersion: "2.1.300",
    });
    const sdkManager = { submit: () => Promise.resolve(), stop: () => Promise.resolve(), kill: () => Promise.resolve(), decide: () => false };
    registerAgentRoutes(app, { database: database.db, manager: sdkManager, terminal: fixture.sessions });
    registerProjectTerminalRoutes(app, { database: database.db, studioHome: fixture.studioHome, model: "haiku", sessions: fixture.sessions });
  });
  const [project] = await database.db.insert(projects).values({ slug: "demo", title: "Demo" }).returning();
  projectId = project?.id ?? "";
});

afterAll(async () => {
  await server.close();
  await database.close();
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalHome;
  await rm(fakeHome, { recursive: true, force: true });
});

const post = (path: string, body: unknown, headers: Record<string, string>) =>
  fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const send = (path: string, body: unknown = {}) => post(path, body, { origin: server.baseUrl, [CSRF_HEADER]: server.csrfToken });

describe("mode T and the user's Claude config", { timeout: REAL_PTY_TEST_TIMEOUT_MS }, () => {
  it("connects, opens, answers every hook and kills without touching ~/.claude or ~/.claude.json", async () => {
    expect(homedir()).toBe(fakeHome);
    touchedPaths.length = 0;

    expect((await send("/api/connect/api-key", { apiKey: "test-key-0000abcd" })).status).toBe(200);
    expect((await send("/api/connect/cloud", { provider: "bedrock", values: { AWS_REGION: "us-east-1" } })).status).toBe(200);
    expect((await send("/api/connect/terminal", { hasAcceptedDisclosure: true })).status).toBe(200);

    const { sessionId } = (await (await send(`/api/projects/${projectId}/terminal`)).json()) as { sessionId: string };
    const session = server.fixture.sessions.find(sessionId);
    if (session === undefined) throw new Error("the terminal did not open");
    await waitFor(() => session.pty.snapshot().includes("RELAY"));

    const credentialsPath = join(fakeHome, ".claude", ".credentials.json");
    const hookPayloads = [
      { hook_event_name: "UserPromptSubmit", prompt: "Make a cut" },
      { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: credentialsPath }, tool_use_id: "toolu_1" },
      { hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: join(server.fixture.projectDir, "cuts.json") }, tool_use_id: "toolu_2" },
      { hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_response: "{}", tool_use_id: "toolu_2" },
      { hook_event_name: "Notification", message: "waiting" },
      { hook_event_name: "Stop", last_assistant_message: "done" },
    ];
    for (const payload of hookPayloads) {
      // As the relay sends it: bearer only, no Origin or CSRF header.
      const response = await post(`/api/terminal/${sessionId}/hooks`, { session_id: sessionId, ...payload }, { authorization: `Bearer ${session.hookToken}` });
      expect(response.status).toBe(200);
    }
    expect((await send(`/api/projects/${projectId}/kill`)).status).toBe(200);
    await waitFor(() => server.fixture.sessions.findByProject(projectId) === undefined);

    const userConfigDir = join(fakeHome, ".claude");
    expect(touchedPaths.length).toBeGreaterThan(0);
    expect(touchedPaths.filter((path) => path === userConfigDir || path.startsWith(`${userConfigDir}/`) || path === `${userConfigDir}.json`)).toEqual([]);
  });
});
