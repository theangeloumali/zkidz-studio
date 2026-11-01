// Created by The Angelo Umali.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConnection } from "../../../src/auth/connection-store.ts";
import { registerConnectRoutes } from "../../../src/auth/routes.ts";
import { createSecretStore } from "../../../src/auth/secret-store.ts";
import { errorBody, toHttpError } from "../../../src/http/http-error.ts";
import { createLogger } from "../../../src/logging/logger.ts";
import type { TerminalAgentVersions } from "../../../src/terminal/agents/agent-versions.ts";
import { memoryKeyring } from "../../auth/memory-keyring.ts";

const INSTALLED: TerminalAgentVersions = { codex: { version: "0.164.0", minVersion: "0.164.0" }, opencode: { version: "2.2.0", minVersion: "2.2.0" } };

describe("connect routes for codex and opencode in a terminal", () => {
  let scratchDir = "";
  let database: StudioDatabaseHandle;
  let keyring: ReturnType<typeof memoryKeyring>;
  let versions: TerminalAgentVersions = INSTALLED;
  let changes = 0;
  let app: Hono;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-agent-connect-"));
    database = await openDatabase({ dataDir: join(scratchDir, "db") });
    await database.migrate();
    keyring = memoryKeyring();
    versions = INSTALLED;
    changes = 0;
    app = new Hono();
    registerConnectRoutes(app, {
      database: database.db,
      secretStore: createSecretStore({ studioHome: scratchDir, platform: "linux", keyring, readMounts: () => Promise.resolve("") }),
      fetch: () => Promise.resolve(new Response("{}", { status: 200 })),
      logger: createLogger(() => undefined),
      claudeVersion: Promise.resolve("2.1.300"),
      agentVersions: () => Promise.resolve(versions),
      onConnectionChanged: () => {
        changes += 1;
      },
    });
    app.onError((error, c) => {
      const httpError = toHttpError(error);
      return c.json(errorBody(httpError), httpError.status);
    });
  });

  afterEach(async () => {
    await database.close();
    await rm(scratchDir, { recursive: true, force: true });
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("reports each agent's installed version beside Claude Code's", async () => {
    const response = await send("GET", "/api/connect");
    expect(await response.json()).toEqual({ mode: null, keyLast4: null, provider: null, claudeVersion: "2.1.300", agentVersions: INSTALLED });
  });

  for (const [agent, mode] of [
    ["codex", "codex_terminal"],
    ["opencode", "opencode_terminal"],
  ] as const) {
    const path = `/api/connect/${agent}-terminal`;

    it(`connects ${agent} only after the disclosure is accepted, and forgets an earlier api key`, async () => {
      await send("POST", "/api/connect/api-key", { apiKey: "test-key-0000abcd" });
      expect((await send("POST", path, {})).status).toBe(400);
      expect((await send("POST", path, { hasAcceptedDisclosure: false })).status).toBe(400);

      const response = await send("POST", path, { hasAcceptedDisclosure: true });
      expect(await response.json()).toEqual({ mode, keyLast4: null, provider: null, claudeVersion: "2.1.300", agentVersions: INSTALLED });
      expect(await readConnection(database.db)).toEqual({ mode });
      expect(keyring.stored).toBeNull();
      expect(changes).toBe(2);
    });

    it(`refuses ${agent} when it is not installed`, async () => {
      versions = { ...INSTALLED, [agent]: { version: null, minVersion: INSTALLED[agent].minVersion } };
      const response = await send("POST", path, { hasAcceptedDisclosure: true });
      expect(response.status).toBe(409);
      expect(await readConnection(database.db)).toBeNull();
    });

    it(`refuses ${agent} older than the version its lockdown was checked against`, async () => {
      versions = { ...INSTALLED, [agent]: { version: "0.0.1", minVersion: INSTALLED[agent].minVersion } };
      expect((await send("POST", path, { hasAcceptedDisclosure: true })).status).toBe(409);
    });
  }
});
