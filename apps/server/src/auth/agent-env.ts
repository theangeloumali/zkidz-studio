// Created by The Angelo Umali.
// The agent child's env, built from an allowlist (plan §6.6): a denylist misses routing and credential variables.
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { assertNever } from "../agent/assert-never.ts";
import { inheritedParentEnv, pickDefined } from "../security/parent-env.ts";
import { PROVIDER_VARIABLES, type CloudProvider } from "./cloud-config.ts";

const OWNER_ONLY_DIR_MODE = 0o700;

export interface TerminalTokens {
  readonly hookToken: string;
  readonly mcpToken: string;
  /** The stdio twin's loopback base (SessionFiles.mcpUrl). */
  readonly mcpUrl: string;
}

export type AgentAuthMode =
  | { readonly kind: "apiKey"; readonly apiKey: string }
  | { readonly kind: "cloud"; readonly provider: CloudProvider; readonly values: Readonly<Record<string, string>> }
  | { readonly kind: "terminal"; readonly tokens: TerminalTokens };

export interface AgentEnvOptions {
  readonly studioHome: string;
  readonly appVersion: string;
  readonly proxyOptIn: boolean;
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Readonly<Record<string, string | undefined>>;
}

/** Empty and app-owned, so modes A and B never see the user's claude.ai login (spike 01, ADR 0002). */
export function agentConfigDir(studioHome: string): string {
  return join(studioHome, "agent-config");
}

export async function ensureAgentConfigDir(configDir: string): Promise<void> {
  await mkdir(configDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  // mkdir's mode is masked by umask and ignored for an existing dir.
  if (process.platform !== "win32") await chmod(configDir, OWNER_ONLY_DIR_MODE);
}

export function buildAgentEnv(mode: AgentAuthMode, options: AgentEnvOptions): Record<string, string> {
  return {
    ...inheritedParentEnv({ proxyOptIn: options.proxyOptIn, parentEnv: options.parentEnv }),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
    CLAUDE_AGENT_SDK_CLIENT_APP: `zkidz-studio/${options.appVersion}`,
    ...credentialEnv(mode, options.studioHome),
  };
}

function credentialEnv(mode: AgentAuthMode, studioHome: string): Record<string, string> {
  switch (mode.kind) {
    case "apiKey":
      return { CLAUDE_CONFIG_DIR: agentConfigDir(studioHome), ANTHROPIC_API_KEY: mode.apiKey };
    case "cloud": {
      const { switchName, required, optional } = PROVIDER_VARIABLES[mode.provider];
      return { CLAUDE_CONFIG_DIR: agentConfigDir(studioHome), [switchName]: "1", ...pickDefined([...required, ...optional], mode.values) };
    }
    case "terminal":
      // Mode T runs on the user's own Claude Code login: no credential and no config dir override (§6.3).
      return {
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        ZKS_HOOK_TOKEN: mode.tokens.hookToken,
        ZKS_MCP_TOKEN: mode.tokens.mcpToken,
        ZKS_MCP_URL: mode.tokens.mcpUrl,
      };
    default:
      return assertNever(mode);
  }
}
