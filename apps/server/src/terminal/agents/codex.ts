// Created by The Angelo Umali.
// OpenAI Codex CLI in mode T (ADR 0007): the user's own sign-in, locked down through argv; events arrive on Claude-shaped hooks.
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { API_ROUTES, HookPayloadSchema, LOOPBACK_HOST, type UsageFigures } from "@zks/shared";
import { z } from "zod";
import type { TerminalTokens } from "../../auth/agent-env.ts";
import { hookToStudioEvents } from "../hook-events.ts";
import { decideTerminalTool } from "../hook-policy.ts";
import { HOOK_RELAY_PATH, MCP_SERVER_PATH } from "../session-files.ts";
import type { AgentAdapter, AgentLaunchRequest } from "./agent-adapter.ts";
import { AgentLaunchError, buildTerminalAgentEnv } from "./agent-env.ts";
import { createAgentFilesDir, writeAgentFile } from "./agent-files.ts";
import { buildAgentInstructions } from "./instructions.ts";

const runFile = promisify(execFile);
const MCP_LIST_TIMEOUT_MS = 10_000;
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
const THREAD_ID = /^[0-9A-Za-z-]+$/;
const McpListSchema = z.array(z.looseObject({ name: z.string().min(1) }));
const TokenTotalsSchema = z.looseObject({ input_tokens: z.int(), cached_input_tokens: z.int().default(0), output_tokens: z.int() });
const RolloutLineSchema = z.looseObject({
  type: z.literal("event_msg"),
  payload: z.looseObject({ type: z.literal("token_count"), info: z.looseObject({ total_token_usage: TokenTotalsSchema }) }),
});

type Environment = Readonly<Record<string, string | undefined>>;

interface CodexAdapterOptions {
  /** Defaults to process.env; injectable so tests can hand in a hostile parent. */
  readonly parentEnv?: Environment;
  /** The user's own MCP servers, each switched off for the session; defaults to `codex mcp list --json`. */
  readonly listUserMcpServers?: (binaryPath: string, env: Readonly<Record<string, string>>) => Promise<readonly string[]>;
}

export function createCodexAdapter(options: CodexAdapterOptions = {}): AgentAdapter {
  const parentEnv = options.parentEnv ?? process.env;
  const listUserMcpServers = options.listUserMcpServers ?? listCodexMcpServers;
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
      const instructions = await buildAgentInstructions(request);
      await writeAgentFile(filesDir, "instructions.md", instructions);
      return { file: binaryPath, args: buildCodexArgs({ request, userMcpServers, instructions }), env, cwd: request.projectDir, filesDir };
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
    usageSource: (threadId) => readRolloutUsage(join(parentEnv["CODEX_HOME"] ?? join(homedir(), ".codex"), "sessions"), threadId),
  };
}

interface CodexArgsRequest {
  readonly request: AgentLaunchRequest;
  readonly userMcpServers: readonly string[];
  readonly instructions: string;
}

function buildCodexArgs({ request, userMcpServers, instructions }: CodexArgsRequest): string[] {
  const isResume = request.resumeSessionId !== undefined;
  const relayCommand = buildRelayCommand(request);
  return [
    ...(isResume ? ["resume"] : []),
    ...["--sandbox", "read-only", "-a", "never", "--dangerously-bypass-hook-trust"],
    ...CODEX_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
    ...config('web_search="disabled"'),
    ...(request.model === undefined ? [] : ["-m", request.model]),
    ...userMcpServers.flatMap((name) => config(`mcp_servers.${tomlKey(name)}.enabled=false`)),
    ...config(`mcp_servers.studio.command=${tomlString(request.nodePath)}`),
    ...config(`mcp_servers.studio.args=[${tomlString(MCP_SERVER_PATH)}]`),
    // Forwarded by name from codex's env, so the tokens never sit in argv.
    ...config('mcp_servers.studio.env_vars=["ZKS_MCP_TOKEN","ZKS_MCP_URL"]'),
    ...config('mcp_servers.studio.default_tools_approval_mode="approve"'),
    ...HOOK_EVENTS.flatMap((event) => config(`hooks.${event}=[{matcher="*",hooks=[{type="command",command=${tomlString(relayCommand)}}]}]`)),
    // developer_instructions adds to codex's base prompt; model_instructions_file would replace it.
    ...config(`developer_instructions=${tomlString(instructions)}`),
    ...(isResume ? [request.resumeSessionId] : []),
  ];
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

async function listCodexMcpServers(binaryPath: string, env: Readonly<Record<string, string>>): Promise<readonly string[]> {
  const { stdout } = await runFile(binaryPath, ["mcp", "list", "--json"], { env, timeout: MCP_LIST_TIMEOUT_MS, shell: false });
  return McpListSchema.parse(JSON.parse(stdout)).map((server) => server.name);
}

/** Codex writes each thread to sessions/YYYY/MM/DD/rollout-<time>-<threadId>.jsonl; the last token_count holds its totals. */
async function readRolloutUsage(sessionsDir: string, threadId: string): Promise<UsageFigures | null> {
  if (!THREAD_ID.test(threadId)) return null;
  const rolloutPath = await findRollout(sessionsDir, threadId);
  if (rolloutPath === null) return null;
  const lines = (await readFile(rolloutPath, "utf8")).split("\n").reverse();
  for (const line of lines) {
    const totals = parseTokenTotals(line);
    // OpenAI counts cached input inside input_tokens; the studio reports the two apart.
    if (totals !== null)
      return { inputTokens: totals.input_tokens - totals.cached_input_tokens, outputTokens: totals.output_tokens, cacheTokens: totals.cached_input_tokens };
  }
  return null;
}

async function findRollout(sessionsDir: string, threadId: string): Promise<string | null> {
  try {
    const names = await readdir(sessionsDir, { recursive: true });
    const match = names.find((name) => name.endsWith(`-${threadId}.jsonl`));
    return match === undefined ? null : join(sessionsDir, match);
  } catch {
    return null;
  }
}

function parseTokenTotals(line: string): z.infer<typeof TokenTotalsSchema> | null {
  if (!line.includes('"token_count"')) return null;
  try {
    const parsed = RolloutLineSchema.safeParse(JSON.parse(line));
    return parsed.success ? parsed.data.payload.info.total_token_usage : null;
  } catch {
    return null;
  }
}
