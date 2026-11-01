// Created by The Angelo Umali.
// Which credential mode is connected. The api key itself lives in the secret store; only its last 4 are kept here.
import type { StudioDatabase } from "@zks/db";
import { CloudProviderSchema, type ConnectionSchema } from "@zks/shared";
import { z } from "zod";
import type { TerminalAgentVersions } from "../terminal/agents/agent-versions.ts";
import type { AgentAuthMode } from "./agent-env.ts";
import type { SecretStore } from "./secret-store.ts";
import { readSettingValue, writeSettingValue } from "./settings-store.ts";

const CONNECTION_KEY = "connection";

const ConnectionRecordSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("api_key"), keyLast4: z.string().length(4) }),
  z.strictObject({ mode: z.literal("cloud"), provider: CloudProviderSchema, values: z.record(z.string(), z.string()) }),
  z.strictObject({ mode: z.literal("terminal") }),
  z.strictObject({ mode: z.literal("codex_terminal") }),
  z.strictObject({ mode: z.literal("opencode_terminal") }),
]);

export type ConnectionRecord = z.infer<typeof ConnectionRecordSchema>;
export type ConnectionDto = z.infer<typeof ConnectionSchema>;

/** Agent-panel credentials: modes A and B. The terminal modes have no agent session. */
export type AgentCredential = Extract<AgentAuthMode, { kind: "apiKey" | "cloud" }>;

export function readConnection(database: StudioDatabase): Promise<ConnectionRecord | null> {
  return readSettingValue(database, CONNECTION_KEY, ConnectionRecordSchema);
}

export function writeConnection(database: StudioDatabase, record: ConnectionRecord): Promise<void> {
  return writeSettingValue(database, CONNECTION_KEY, record);
}

export interface InstalledAgentVersions {
  readonly claudeVersion: string | null;
  readonly agentVersions: TerminalAgentVersions;
}

export function toConnectionDto(record: ConnectionRecord | null, { claudeVersion, agentVersions }: InstalledAgentVersions): ConnectionDto {
  return {
    mode: record?.mode ?? null,
    keyLast4: record?.mode === "api_key" ? record.keyLast4 : null,
    provider: record?.mode === "cloud" ? record.provider : null,
    claudeVersion,
    agentVersions,
  };
}

/** Null when nothing usable is connected: no record, a terminal mode, or a key record whose secret has gone. */
export async function loadAgentCredential(database: StudioDatabase, secretStore: SecretStore): Promise<AgentCredential | null> {
  const record = await readConnection(database);
  if (record?.mode === "cloud") return { kind: "cloud", provider: record.provider, values: record.values };
  if (record?.mode !== "api_key") return null;
  const apiKey = await secretStore.readApiKey();
  return apiKey === null ? null : { kind: "apiKey", apiKey };
}
