// Created by The Angelo Umali.
// Connect + settings routes (plan §6.5). The key is checked before it is stored, and never echoed back.
import type { StudioDatabase } from "@zks/db";
import { AGENT_LABELS, API_ROUTES, type TerminalAgentKind } from "@zks/shared";
import type { Hono } from "hono";
import { HttpError, parseOrBadRequest, readJsonBody } from "../http/http-error.ts";
import type { Logger } from "../logging/logger.ts";
import { detectTerminalAgentVersions, isSupportedVersion, type TerminalAgentVersions } from "../terminal/agents/agent-versions.ts";
import { CloudConfigError, parseCloudValues } from "./cloud-config.ts";
import { readConnection, toConnectionDto, writeConnection, type ConnectionRecord } from "./connection-store.ts";
import { checkApiKey, type FetchFunction, type KeyCheckResult } from "./key-check.ts";
import type { SecretStore } from "./secret-store.ts";
import { readSettings, updateSettings } from "./settings-store.ts";

const KEY_LAST4_LENGTH = 4;

export interface ConnectRouteDeps {
  readonly database: StudioDatabase;
  readonly secretStore: SecretStore;
  readonly fetch: FetchFunction;
  readonly logger: Logger;
  /** `claude --version` runs after the server listens, so routes await it. */
  readonly claudeVersion: string | null | Promise<string | null>;
  /** Probes Codex and OpenCode; defaults to the real binaries on PATH. */
  readonly agentVersions?: () => Promise<TerminalAgentVersions>;
  /** Lets the agent manager drop sessions built on the old credential. */
  readonly onConnectionChanged?: () => void;
}

export function registerConnectRoutes(app: Hono, deps: ConnectRouteDeps): void {
  const probeAgentVersions = deps.agentVersions ?? (() => detectTerminalAgentVersions());
  // GET reuses the last probe; a connect probes again, so an agent installed since then counts.
  let latestAgentVersions: Promise<TerminalAgentVersions> | null = null;
  const refreshAgentVersions = (): Promise<TerminalAgentVersions> => (latestAgentVersions = probeAgentVersions());
  const respondWith = async (record: ConnectionRecord | null) =>
    toConnectionDto(record, { claudeVersion: await deps.claudeVersion, agentVersions: await (latestAgentVersions ?? refreshAgentVersions()) });

  app.get(API_ROUTES.getConnection.path, async (c) => c.json(await respondWith(await readConnection(deps.database))));

  app.post(API_ROUTES.connectApiKey.path, async (c) => {
    const { apiKey } = parseOrBadRequest(API_ROUTES.connectApiKey.body, await readJsonBody(c));
    throwUnlessAccepted(await checkApiKey(apiKey, deps));
    await deps.secretStore.writeApiKey(apiKey);
    const record = { mode: "api_key", keyLast4: apiKey.slice(-KEY_LAST4_LENGTH).padStart(KEY_LAST4_LENGTH, "*") } as const;
    await writeConnection(deps.database, record);
    deps.onConnectionChanged?.();
    return c.json(await respondWith(record));
  });

  app.post(API_ROUTES.connectCloud.path, async (c) => {
    const { provider, values } = parseOrBadRequest(API_ROUTES.connectCloud.body, await readJsonBody(c));
    const record = { mode: "cloud", provider, values: parseCloudValuesOrBadRequest(provider, values) } as const;
    await writeConnection(deps.database, record);
    // One credential at a time: a stale key must not resurface if mode A is picked again later.
    await deps.secretStore.deleteApiKey();
    deps.onConnectionChanged?.();
    return c.json(await respondWith(record));
  });

  app.post(API_ROUTES.connectTerminal.path, async (c) => {
    parseOrBadRequest(API_ROUTES.connectTerminal.body, await readJsonBody(c));
    const record = { mode: "terminal" } as const;
    await writeConnection(deps.database, record);
    await deps.secretStore.deleteApiKey();
    deps.onConnectionChanged?.();
    return c.json(await respondWith(record));
  });

  for (const [agent, route] of [
    ["codex", API_ROUTES.connectCodexTerminal],
    ["opencode", API_ROUTES.connectOpenCodeTerminal],
  ] as const) {
    app.post(route.path, async (c) => {
      parseOrBadRequest(route.body, await readJsonBody(c));
      throwUnlessSupported(agent, (await refreshAgentVersions())[agent]);
      const record = { mode: `${agent}_terminal` } as const;
      await writeConnection(deps.database, record);
      await deps.secretStore.deleteApiKey();
      deps.onConnectionChanged?.();
      return c.json(await respondWith(record));
    });
  }

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

function throwUnlessSupported(agent: TerminalAgentKind, installed: TerminalAgentVersions[TerminalAgentKind]): void {
  if (isSupportedVersion(installed)) return;
  const label = AGENT_LABELS[agent];
  const found = installed.version === null ? `${label} is not installed` : `${label} ${installed.version} is installed`;
  throw new HttpError(409, `${found}; ZKidz Studio needs ${label} ${installed.minVersion} or newer`);
}

function parseCloudValuesOrBadRequest(...args: Parameters<typeof parseCloudValues>): Record<string, string> {
  try {
    return parseCloudValues(...args);
  } catch (error) {
    if (error instanceof CloudConfigError) throw new HttpError(400, error.message);
    throw error;
  }
}
