// Created by The Angelo Umali.
// OpenAI Codex CLI in mode T (ADR 0007): the user's own sign-in, locked down by flags that codex is asked to confirm before launch.
import { homedir } from "node:os";
import { join } from "node:path";
import { AGENT_MIN_VERSIONS, HookPayloadSchema } from "@zks/shared";
import { terminalTokenEnv } from "../../auth/agent-env.ts";
import { hookToStudioEvents } from "../hook-events.ts";
import { terminalHookUrl } from "../../tools/mcp-paths.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH, withSessionFolder } from "../session-files.ts";
import type { AgentAdapter, AgentLaunchRequest } from "./agent-adapter.ts";
import { AgentLaunchError, buildTerminalAgentEnv } from "./agent-env.ts";
import {
  assertLockedPermissions,
  assertOnlyStudioHooks,
  assertOnlyStudioMcp,
  assertOnlyStudioTools,
  exposedToolNames,
  hookStateOverride,
  writeStudioModelCatalog,
  type CodexSetup,
} from "./codex-lockdown.ts";
import { readCodexPrompt, readCodexSetup, type CodexProbe } from "./codex-probes.ts";
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
  /** The hooks and effective config codex would load with these args; defaults to the app-server's hooks/list and config/read. */
  readonly readSetup?: (probe: CodexProbe) => Promise<CodexSetup>;
  /** What codex would show the model with these args; defaults to `codex debug prompt-input`. */
  readonly readPrompt?: typeof readCodexPrompt;
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): AgentAdapter {
  const parentEnv = options.parentEnv ?? process.env;
  const readSetup = options.readSetup ?? readCodexSetup;
  const readPrompt = options.readPrompt ?? readCodexPrompt;
  const codexHome = parentEnv["CODEX_HOME"] ?? join(homedir(), ".codex");
  return {
    kind: "codex",
    binaryNames: ["codex", "codex.exe", "codex.cmd"],
    versionArgs: ["--version"],
    minVersion: AGENT_MIN_VERSIONS.codex,
    async prepare(request, tokens, binaryPath) {
      const env = buildTerminalAgentEnv({ parentEnv, inheritNames: ["CODEX_HOME"], extraEnv: terminalTokenEnv(tokens) });
      const probe = (launchArgs: readonly string[]): CodexProbe => ({ binaryPath, launchArgs, env, cwd: request.projectDir });
      return withSessionFolder(request.runDir, request.sessionId, async (filesDir) => {
        const catalogPath = await writeStudioModelCatalog(codexHome, filesDir, await buildAgentInstructions(request));
        const relayCommand = buildRelayCommand(request);
        const baseArgs = buildCodexLaunchArgs({ request, catalogPath, relayCommand });
        const found = await asked(readSetup(probe(baseArgs)));
        const userMcpServers = Object.keys(found.mcpServers).filter((name) => name !== STUDIO_MCP_NAME);
        const launchArgs = [
          ...baseArgs,
          ...userMcpServers.flatMap((name) => config(`mcp_servers.${tomlKey(name)}.enabled=false`)),
          ...config(hookStateOverride(found.hooks, relayCommand)),
        ];
        // Codex is asked again with the final argv: the launch is refused unless what it reports is what the studio allows.
        const [setup, promptInput] = await asked(Promise.all([readSetup(probe(launchArgs)), readPrompt(probe(launchArgs))]));
        assertOnlyStudioMcp(setup);
        assertOnlyStudioHooks(setup.hooks, relayCommand, HOOK_EVENTS.length);
        assertOnlyStudioTools(exposedToolNames(promptInput));
        assertLockedPermissions(promptInput);
        const args = request.resumeSessionId === undefined ? launchArgs : ["resume", ...launchArgs, request.resumeSessionId];
        return { file: binaryPath, args, env, cwd: request.projectDir, filesDir };
      });
    },
    // Codex fires SessionStart with the first prompt, so its drawn composer is what lets the Prompt box send one.
    inputReady: /›|>_/,
    events: {
      kind: "hooks",
      mapHook(payload, context) {
        const parsed = HookPayloadSchema.safeParse(payload);
        if (!parsed.success) return [];
        return hookToStudioEvents(parsed.data, context).map((event) => (event.type === "session.started" ? { ...event, credential: CODEX_CREDENTIAL } : event));
      },
    },
    usageSource: createRolloutUsageReader(join(codexHome, "sessions")),
  };
}

interface CodexArgsRequest {
  readonly request: AgentLaunchRequest;
  readonly catalogPath: string;
  readonly relayCommand: string;
}

/** Top-level flags only, so the TUI, the app-server and prompt-input all read the very same session config. */
function buildCodexLaunchArgs({ request, catalogPath, relayCommand }: CodexArgsRequest): string[] {
  return [
    // Flags and keys both; prompt-input then confirms what codex actually resolved.
    ...["--sandbox", "read-only", "--ask-for-approval", "never"],
    ...config('sandbox_mode="read-only"'),
    ...config('approval_policy="never"'),
    ...config("include_permissions_instructions=true"),
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...config('web_search="disabled"'),
    ...(request.model === undefined ? [] : config(`model=${tomlString(request.model)}`)),
    ...config(`model_catalog_json=${tomlString(catalogPath)}`),
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
  const parts = [request.nodePath, HOOK_RELAY_PATH, terminalHookUrl(request.appPort, request.sessionId)];
  if (parts.some((part) => part.includes('"')))
    throw new AgentLaunchError("config_conflict", "The node or studio path contains a quote, so the hook command cannot be built safely.");
  return parts.map((part) => `"${part}"`).join(" ");
}

const config = (override: string) => ["-c", override];
// A JSON string is a valid TOML basic string, which is how codex parses every -c value.
const tomlString = (value: string) => JSON.stringify(value);
const tomlKey = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key));
