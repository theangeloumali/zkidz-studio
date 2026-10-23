// Created by The Angelo Umali.
// The locked-down SDK options (plan §6.6): no user settings, one inline plugin, three built-ins, the studio MCP server only.
import type { McpServerConfig, Options } from "@anthropic-ai/claude-agent-sdk";
import type { AgentCredential } from "../auth/connection-store.ts";
import { createConfineReadsHook } from "./confine-reads.ts";
import type { DecisionBroker } from "./decisions.ts";
import { BASE_TOOLS, DISALLOWED_TOOLS } from "./init-assertion.ts";
import { createToolDecider } from "./policy.ts";

// Tried in order when the primary model is overloaded or unavailable (plan §6.6); the SDK retries the primary each turn.
const FALLBACK_MODELS = "sonnet,haiku";

export interface SessionLimits {
  readonly maxTurns: number;
  /** Mode A only: cloud billing has no SDK budget cap. */
  readonly maxBudgetUsd: number;
  readonly model?: string;
}

export interface QueryOptionsInput {
  readonly projectId: string;
  readonly projectDir: string;
  readonly pluginDir: string;
  readonly credential: AgentCredential;
  readonly env: Record<string, string>;
  readonly broker: DecisionBroker;
  readonly limits: SessionLimits;
  readonly studioMcpServer: McpServerConfig | null;
}

export function buildQueryOptions(input: QueryOptionsInput): Options {
  const { projectId, projectDir, pluginDir, limits } = input;
  return {
    cwd: projectDir,
    env: input.env,
    settingSources: [],
    plugins: [{ type: "local", path: pluginDir }],
    tools: [...BASE_TOOLS],
    disallowedTools: [...DISALLOWED_TOOLS],
    ...(input.studioMcpServer === null ? {} : { mcpServers: { studio: input.studioMcpServer } }),
    strictMcpConfig: true,
    permissionMode: "default",
    canUseTool: createToolDecider({ projectId, broker: input.broker }),
    hooks: { PreToolUse: [{ matcher: "Read", hooks: [createConfineReadsHook({ projectDir, pluginDir })] }] },
    includePartialMessages: true,
    maxTurns: limits.maxTurns,
    ...(input.credential.kind === "apiKey" ? { maxBudgetUsd: limits.maxBudgetUsd } : {}),
    ...(limits.model === undefined ? {} : { model: limits.model }),
    fallbackModel: FALLBACK_MODELS,
  };
}
