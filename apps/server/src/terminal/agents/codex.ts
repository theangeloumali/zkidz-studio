// Created by The Angelo Umali.
// OpenAI Codex CLI in mode T (ADR 0007): the user's own sign-in, locked down by config flags that codex is asked to confirm before launch.
import { homedir } from "node:os";
import { join } from "node:path";
import { API_ROUTES, HookPayloadSchema, LOOPBACK_HOST } from "@zks/shared";
import type { TerminalTokens } from "../../auth/agent-env.ts";
import { hookToStudioEvents } from "../hook-events.ts";
import { decideTerminalTool } from "../hook-policy.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH } from "../session-files.ts";
import type { AgentAdapter, AgentLaunchRequest } from "./agent-adapter.ts";
import { AgentLaunchError, buildTerminalAgentEnv } from "./agent-env.ts";
import { createAgentFilesDir, removeAgentFiles } from "./agent-files.ts";
import { assertOnlyStudioHooks, assertOnlyStudioTools, hookStateOverride, writeStudioModelCatalog, type CodexHook } from "./codex-lockdown.ts";
import { listCodexHooks, listCodexMcpServers, listCodexTools, type CodexProbe } from "./codex-probes.ts";
import { createRolloutUsageReader } from "./codex-usage.ts";
import { buildAgentInstructions } from "./instructions.ts";

const CODEX_CREDENTIAL = "your Codex sign-in";
const STUDIO_MCP_NAME = "studio";
const HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"] as const;
/** Every codex 0.164 feature that reaches a shell, the web, the screen or another agent (spike, ADR 0007). */
export const CODEX_DISABLED_FEATURES = [
  "shell_tool",
  "unified_exec",
  "unified_exec_tty",
  "view_image",
  "apps",
  "plugins",
  "browser_use",
  "browser_use_external",
  "computer_use",
  "image_generation",
  "in_app_browser",
  "multi_agent",
  "goals",
  "skill_search",
  "tool_suggest",
  "sleep_tool",
  "shell_snapshot",
  "remote_plugin",
  "worktrees",
] as const;

type Environment = Readonly<Record<string, string | undefined>>;

interface CodexAdapterOptions {
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Environment;
  /** The user's own MCP servers, each switched off for the session; defaults to `codex mcp list --json`. */
  readonly listUserMcpServers?: (binaryPath: string, env: Readonly<Record<string, string>>) => Promise<readonly string[]>;
  /** The hooks codex would load with these args; defaults to the app-server's hooks/list. */
  readonly listHooks?: (probe: CodexProbe) => Promise<readonly CodexHook[]>;
  /** The tools codex would show the model with these args; defaults to `codex debug prompt-input`. */
  readonly listExposedTools?: (probe: CodexProbe) => Promise<readonly string[]>;
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): AgentAdapter {
  const parentEnv = options.parentEnv ?? process.env;
  const listUserMcpServers = options.listUserMcpServers ?? listCodexMcpServers;
  const listHooks = options.listHooks ?? listCodexHooks;
  const listExposedTools = options.listExposedTools ?? listCodexTools;
  const codexHome = parentEnv["CODEX_HOME"] ?? join(homedir(), ".codex");
  return {
    kind: "codex",
    label: "Codex",
    binaryNames: ["codex", "codex.exe", "codex.cmd"],
    versionArgs: ["--version"],
    minVersion: "0.164.0",
    async prepare(request, tokens, binaryPath) {
      const env = buildTerminalAgentEnv({ parentEnv, inheritNames: ["CODEX_HOME"], extraEnv: tokenEnv(tokens) });
      const userMcpServers = await listUserMcpServers(binaryPath, env).catch((error: unknown) => {
        throw new AgentLaunchError("config_conflict", `Codex could not list your MCP servers, so they cannot be switched off: ${String(error)}`);
      });
      if (userMcpServers.includes(STUDIO_MCP_NAME))
        throw new AgentLaunchError("config_conflict", "Your Codex config already has an MCP server named studio; rename it to use ZKidz Studio.");
      const filesDir = await createAgentFilesDir(request.runDir, request.sessionId);
      const probe = (configArgs: readonly string[]): CodexProbe => ({ binaryPath, configArgs, env, cwd: request.projectDir });
      try {
        const catalogPath = await writeStudioModelCatalog(codexHome, filesDir, await buildAgentInstructions(request));
        const relayCommand = buildRelayCommand(request);
        const baseArgs = buildCodexConfigArgs({ request, userMcpServers, catalogPath, relayCommand });
        const hookState = hookStateOverride(await asked(listHooks(probe(baseArgs))), relayCommand);
        const configArgs = [...baseArgs, ...config(hookState)];
        // Codex is asked again with the final args: the launch is refused unless what it reports is what the studio allows.
        const [hooks, tools] = await asked(Promise.all([listHooks(probe(configArgs)), listExposedTools(probe(configArgs))]));
        assertOnlyStudioHooks(hooks, relayCommand, HOOK_EVENTS.length);
        assertOnlyStudioTools(tools);
        const args = request.resumeSessionId === undefined ? configArgs : ["resume", ...configArgs, request.resumeSessionId];
        return { file: binaryPath, args, env, cwd: request.projectDir, filesDir };
      } catch (error) {
        await removeAgentFiles(filesDir);
        throw error;
      }
    },
    events: {
      kind: "hooks",
      mapHook(payload, context) {
        const parsed = HookPayloadSchema.safeParse(payload);
        if (!parsed.success) return [];
        return hookToStudioEvents(parsed.data, context).map((event) => (event.type === "session.started" ? { ...event, credential: CODEX_CREDENTIAL } : event));
      },
    },
    decideTool: decideTerminalTool,
    usageSource: createRolloutUsageReader(join(codexHome, "sessions")),
  };
}

interface CodexArgsRequest {
  readonly request: AgentLaunchRequest;
  readonly userMcpServers: readonly string[];
  readonly catalogPath: string;
  readonly relayCommand: string;
}

/** Config keys only, so the TUI, the app-server and prompt-input all read the very same session config. */
function buildCodexConfigArgs({ request, userMcpServers, catalogPath, relayCommand }: CodexArgsRequest): string[] {
  return [
    ...config('sandbox_mode="read-only"'),
    ...config('approval_policy="never"'),
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...config('web_search="disabled"'),
    ...(request.model === undefined ? [] : config(`model=${tomlString(request.model)}`)),
    ...config(`model_catalog_json=${tomlString(catalogPath)}`),
    ...userMcpServers.flatMap((name) => config(`mcp_servers.${tomlKey(name)}.enabled=false`)),
    ...config(`mcp_servers.studio.command=${tomlString(request.nodePath)}`),
    ...config(`mcp_servers.studio.args=[${tomlString(MCP_SERVER_PATH)}]`),
    // Forwarded by name from codex's env, so the tokens never sit in argv.
    ...config('mcp_servers.studio.env_vars=["ZKS_MCP_TOKEN","ZKS_MCP_URL"]'),
    ...config('mcp_servers.studio.default_tools_approval_mode="approve"'),
    ...HOOK_EVENTS.flatMap((event) => config(`hooks.${event}=[{matcher="*",hooks=[{type="command",command=${tomlString(relayCommand)}}]}]`)),
  ];
}

/** A probe that fails leaves the session unchecked, so it is refused. */
async function asked<T>(probe: Promise<T>): Promise<T> {
  return probe.catch((error: unknown) => {
    throw error instanceof AgentLaunchError
      ? error
      : new AgentLaunchError("config_conflict", `Codex could not be checked before the session started: ${String(error)}`);
  });
}

function buildRelayCommand(request: AgentLaunchRequest): string {
  const hookUrl = `http://${LOOPBACK_HOST}:${request.appPort}${API_ROUTES.terminalHooks.path.replace(":sessionId", request.sessionId)}`;
  const parts = [request.nodePath, HOOK_RELAY_PATH, hookUrl];
  if (parts.some((part) => part.includes('"')))
    throw new AgentLaunchError("config_conflict", "The node or studio path contains a quote, so the hook command cannot be built safely.");
  return parts.map((part) => `"${part}"`).join(" ");
}

function tokenEnv(tokens: TerminalTokens): Record<string, string> {
  return { ZKS_HOOK_TOKEN: tokens.hookToken, ZKS_MCP_TOKEN: tokens.mcpToken, ZKS_MCP_URL: tokens.mcpUrl };
}

const config = (override: string) => ["-c", override];
// A JSON string is a valid TOML basic string, which is how codex parses every -c value.
const tomlString = (value: string) => JSON.stringify(value);
const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key));
