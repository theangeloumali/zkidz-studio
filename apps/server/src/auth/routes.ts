// Created by The Angelo Umali.
// Connect + settings routes (plan §6.5). The key is checked before it is stored, and never echoed back.
import type { StudioDatabase } from "@zks/db";
import { API_ROUTES } from "@zks/shared";
import type { Hono } from "hono";
import { HttpError, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import { CloudConfigError, parseCloudValues } from "./cloud-config.ts";
import { readConnection, toConnectionDto, writeConnection } from "./connection-store.ts";
import { checkApiKey, type FetchFunction, type KeyCheckResult } from "./key-check.ts";
import type { SecretStore } from "./secret-store.ts";
import { readSettings, updateSettings } from "./settings-store.ts";

const KEY_LAST4_LENGTH = 4;

export interface ConnectRouteDeps {
  readonly database: StudioDatabase;
  readonly secretStore: SecretStore;
  readonly fetch: FetchFunction;
  readonly logger: Logger;
  readonly claudeVersion: string | null;
  /** Lets the agent manager drop sessions built on the old credential. */
  readonly onConnectionChanged?: () => void;
}

export function registerConnectRoutes(app: Hono, deps: ConnectRouteDeps): void {
  app.get(API_ROUTES.getConnection.path, async (c) => c.json(toConnectionDto(await readConnection(deps.database), deps.claudeVersion)));

  app.post(API_ROUTES.connectApiKey.path, async (c) => {
    const { apiKey } = parseOrBadRequest(API_ROUTES.connectApiKey.body, await readJsonBody(c));
    throwUnlessAccepted(await checkApiKey(apiKey, deps));
    await deps.secretStore.writeApiKey(apiKey);
    const record = { mode: "api_key", keyLast4: apiKey.slice(-KEY_LAST4_LENGTH).padStart(KEY_LAST4_LENGTH, "*") } as const;
    await writeConnection(deps.database, record);
    deps.onConnectionChanged?.();
    return c.json(toConnectionDto(record, deps.claudeVersion));
  });

  app.post(API_ROUTES.connectCloud.path, async (c) => {
    const { provider, values } = parseOrBadRequest(API_ROUTES.connectCloud.body, await readJsonBody(c));
    const record = { mode: "cloud", provider, values: parseCloudValuesOrBadRequest(provider, values) } as const;
    await writeConnection(deps.database, record);
    // One credential at a time: a stale key must not resurface if mode A is picked again later.
    await deps.secretStore.deleteApiKey();
    deps.onConnectionChanged?.();
    return c.json(toConnectionDto(record, deps.claudeVersion));
  });

  app.post(API_ROUTES.connectTerminal.path, async (c) => {
    parseOrBadRequest(API_ROUTES.connectTerminal.body, await readJsonBody(c));
    const record = { mode: "terminal" } as const;
    await writeConnection(deps.database, record);
    await deps.secretStore.deleteApiKey();
    deps.onConnectionChanged?.();
    return c.json(toConnectionDto(record, deps.claudeVersion));
  });

  app.get(API_ROUTES.getSettings.path, async (c) => c.json(await readSettings(deps.database)));

  app.put(API_ROUTES.updateSettings.path, async (c) => {
    const patch = parseOrBadRequest(API_ROUTES.updateSettings.body, await readJsonBody(c));
    return c.json(await updateSettings(deps.database, patch));
  });
}

function throwUnlessAccepted(result: KeyCheckResult): void {
  if (result.ok) return;
  if (result.reason === "rejected") throw new HttpError(400, "Anthropic rejected this API key", "key_rejected");
  throw new HttpError(502, "Could not verify the key with Anthropic; try again");
}

function parseCloudValuesOrBadRequest(...args: Parameters<typeof parseCloudValues>): Record<string, string> {
  try {
    return parseCloudValues(...args);
  } catch (error) {
    if (error instanceof CloudConfigError) throw new HttpError(400, error.message);
    throw error;
  }
}
