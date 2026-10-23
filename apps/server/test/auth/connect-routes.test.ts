// Created by The Angelo Umali.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, type StudioDatabaseHandle } from "@zks/db";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConnection } from "../../src/auth/connection-store.ts";
import { registerConnectRoutes, type ConnectRouteDeps } from "../../src/auth/routes.ts";
import { createSecretStore } from "../../src/auth/secret-store.ts";
import { toHttpError } from "../../src/http/http-error.ts";
import { createLogger } from "../../src/logging/logger.ts";
import { memoryKeyring } from "./memory-keyring.ts";

const API_KEY = "test-key-0000abcd";

describe("connect routes", () => {
  let scratchDir = "";
  let database: StudioDatabaseHandle;
  let keyring: ReturnType<typeof memoryKeyring>;
  let modelsStatus = 200;
  let changes = 0;
  let app: Hono;

  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-connect-"));
    database = await openDatabase({ dataDir: join(scratchDir, "db") });
    await database.migrate();
    keyring = memoryKeyring();
    modelsStatus = 200;
    changes = 0;
    const deps: ConnectRouteDeps = {
      database: database.db,
      secretStore: createSecretStore({ studioHome: scratchDir, platform: "linux", keyring, readMounts: () => Promise.resolve("") }),
      fetch: () => Promise.resolve(new Response("{}", { status: modelsStatus })),
      logger: createLogger(() => undefined),
      claudeVersion: "2.1.300",
      onConnectionChanged: () => {
        changes += 1;
      },
    };
    app = new Hono();
    registerConnectRoutes(app, deps);
    app.onError((error, c) => {
      const httpError = toHttpError(error);
      return c.json({ error: httpError.message }, httpError.status);
    });
  });

  afterEach(async () => {
    await database.close();
    await rm(scratchDir, { recursive: true, force: true });
  });

  const send = (method: string, path: string, body?: unknown) =>
    app.request(path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

  it("starts disconnected", async () => {
    const response = await send("GET", "/api/connect");
    expect(await response.json()).toEqual({ mode: null, keyLast4: null, provider: null, claudeVersion: "2.1.300" });
  });

  it("stores a key that Anthropic accepts and returns only its last 4", async () => {
    const response = await send("POST", "/api/connect/api-key", { apiKey: `  ${API_KEY}  ` });

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain(API_KEY);
    expect(JSON.parse(body)).toEqual({ mode: "api_key", keyLast4: "abcd", provider: null, claudeVersion: "2.1.300" });
    expect(keyring.stored).toBe(API_KEY);
    expect(changes).toBe(1);
  });

  it("keeps the old state when Anthropic rejects the key", async () => {
    modelsStatus = 401;
    const response = await send("POST", "/api/connect/api-key", { apiKey: "bad-key" });

    expect(response.status).toBe(400);
    expect(keyring.stored).toBeNull();
    expect(await readConnection(database.db)).toBeNull();
    expect(changes).toBe(0);
  });

  it("answers 502 when the key check cannot get a verdict", async () => {
    modelsStatus = 529;
    expect((await send("POST", "/api/connect/api-key", { apiKey: API_KEY })).status).toBe(502);
  });

  it("connects a cloud provider and forgets an earlier api key", async () => {
    await send("POST", "/api/connect/api-key", { apiKey: API_KEY });
    const response = await send("POST", "/api/connect/cloud", { provider: "bedrock", values: { AWS_REGION: "us-east-1" } });

    expect(await response.json()).toEqual({ mode: "cloud", keyLast4: null, provider: "bedrock", claudeVersion: "2.1.300" });
    expect(keyring.stored).toBeNull();
    expect(await readConnection(database.db)).toEqual({ mode: "cloud", provider: "bedrock", values: { AWS_REGION: "us-east-1" } });
  });

  it("connects mode T only after the disclosure is accepted, and forgets an earlier api key", async () => {
    await send("POST", "/api/connect/api-key", { apiKey: API_KEY });
    expect((await send("POST", "/api/connect/terminal", {})).status).toBe(400);
    expect((await send("POST", "/api/connect/terminal", { hasAcceptedDisclosure: false })).status).toBe(400);
    expect(changes).toBe(1);

    const response = await send("POST", "/api/connect/terminal", { hasAcceptedDisclosure: true });
    expect(await response.json()).toEqual({ mode: "terminal", keyLast4: null, provider: null, claudeVersion: "2.1.300" });
    expect(await readConnection(database.db)).toEqual({ mode: "terminal" });
    expect(keyring.stored).toBeNull();
    expect(changes).toBe(2);
  });

  it("rejects a cloud secret with 400", async () => {
    const response = await send("POST", "/api/connect/cloud", { provider: "bedrock", values: { AWS_REGION: "us-east-1", AWS_SECRET_ACCESS_KEY: "x" } });
    expect(response.status).toBe(400);
    expect(await readConnection(database.db)).toBeNull();
  });

  it("reads and updates settings, rejecting unknown keys", async () => {
    expect(await (await send("GET", "/api/settings")).json()).toEqual({ proxyOptIn: false });
    expect(await (await send("PUT", "/api/settings", { proxyOptIn: true })).json()).toEqual({ proxyOptIn: true });
    expect(await (await send("GET", "/api/settings")).json()).toEqual({ proxyOptIn: true });
    expect((await send("PUT", "/api/settings", { telemetry: true })).status).toBe(400);
  });
});
