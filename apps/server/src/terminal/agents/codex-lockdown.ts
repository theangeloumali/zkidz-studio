// Created by The Angelo Umali.
// What a studio Codex session may show the model and run (ADR 0007): a direct-mode model catalog, a tool allowlist, studio-only hooks.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { AgentLaunchError } from "./agent-env.ts";
import { writeAgentFile } from "./agent-files.ts";

const CATALOG_FILE = "codex-models.json";
const STUDIO_TOOL_NAMESPACE = "mcp__studio.";
/** Reading MCP resources only reaches the studio's server: every other MCP server is switched off. */
const ALLOWED_CODEX_TOOLS = new Set([
  "functions.request_user_input",
  "functions.list_mcp_resources",
  "functions.list_mcp_resource_templates",
  "functions.read_mcp_resource",
]);

const ModelCacheSchema = z.looseObject({
  models: z.array(z.looseObject({ model_messages: z.looseObject({ instructions_template: z.string() }) })).min(1),
});
interface CodexTool {
  readonly type: string;
  readonly name: string;
  readonly tools?: readonly CodexTool[] | undefined;
}
const CodexToolSchema: z.ZodType<CodexTool> = z.looseObject({
  type: z.string(),
  name: z.string(),
  get tools() {
    return z.array(CodexToolSchema).optional();
  },
});
const PromptInputSchema = z.array(z.looseObject({ type: z.string(), tools: z.array(CodexToolSchema).optional() }));
export const CodexHookSchema = z.looseObject({
  key: z.string().min(1),
  source: z.string(),
  enabled: z.boolean(),
  trustStatus: z.string(),
  currentHash: z.string().min(1),
  handlerType: z.string(),
  command: z.string().optional(),
});
export type CodexHook = z.infer<typeof CodexHookSchema>;

/**
 * Codex's own model list, rewritten so no model runs in code mode (a JS `exec` that nests tools past the hooks) or with
 * sub-agents, and with the studio's instructions added to each base prompt; a file, so they never sit in argv.
 */
export async function writeStudioModelCatalog(codexHome: string, filesDir: string, instructions: string): Promise<string> {
  const cache = await readFile(join(codexHome, "models_cache.json"), "utf8")
    .then((text) => ModelCacheSchema.parse(JSON.parse(text)))
    .catch(() => {
      throw new AgentLaunchError("config_conflict", "Codex has not downloaded its model list yet; open Codex once, then start the session again.");
    });
  const models = cache.models.map(({ multi_agent_version, ...model }) => ({
    ...model,
    tool_mode: "direct",
    supports_search_tool: false,
    experimental_supported_tools: [],
    apply_patch_tool_type: null,
    model_messages: { ...model.model_messages, instructions_template: `${model.model_messages.instructions_template}\n\n${instructions}` },
  }));
  return writeAgentFile(filesDir, CATALOG_FILE, JSON.stringify({ models }));
}

/** Tool names from `codex debug prompt-input`, namespaced as "<namespace>.<tool>". */
export function exposedToolNames(promptInput: unknown): string[] {
  const toolLists = PromptInputSchema.parse(promptInput).flatMap((item) => (item.type === "additional_tools" && item.tools !== undefined ? [item.tools] : []));
  if (toolLists.length === 0) throw new Error("codex debug prompt-input listed no tools section");
  const names = (tools: readonly CodexTool[], prefix: string): string[] =>
    tools.flatMap((tool) => (tool.type === "namespace" ? names(tool.tools ?? [], `${prefix}${tool.name}.`) : [`${prefix}${tool.name}`]));
  return toolLists.flatMap((tools) => names(tools, ""));
}

export function assertOnlyStudioTools(toolNames: readonly string[]): void {
  const unconfined = toolNames.filter((name) => !ALLOWED_CODEX_TOOLS.has(name) && !name.startsWith(STUDIO_TOOL_NAMESPACE));
  if (unconfined.length > 0)
    throw new AgentLaunchError(
      "config_conflict",
      `Codex would offer tools ZKidz Studio cannot confine (${unconfined.join(", ")}), so the session was not started.`,
    );
}

const isStudioHook = (hook: CodexHook, relayCommand: string) =>
  hook.source === "sessionFlags" && hook.handlerType === "command" && hook.command === relayCommand;

/** Trusts the studio's own hooks by their current hash and switches every other hook off, for this session only. */
export function hookStateOverride(hooks: readonly CodexHook[], relayCommand: string): string {
  const entries = hooks.map((hook) => {
    const state = isStudioHook(hook, relayCommand) ? `{trusted_hash=${JSON.stringify(hook.currentHash)}}` : "{enabled=false}";
    return `${JSON.stringify(hook.key)}=${state}`;
  });
  return `hooks.state={${entries.join(",")}}`;
}

/** Checks the hooks codex reports with the final args: only the studio's run, and every one of them does. */
export function assertOnlyStudioHooks(hooks: readonly CodexHook[], relayCommand: string, studioHookCount: number): void {
  const foreign = hooks.filter((hook) => hook.enabled && !isStudioHook(hook, relayCommand));
  if (foreign.length > 0)
    throw new AgentLaunchError(
      "config_conflict",
      `Codex would still run hooks ZKidz Studio did not write (${foreign.map((hook) => hook.key).join(", ")}), so the session was not started.`,
    );
  const studio = hooks.filter((hook) => isStudioHook(hook, relayCommand) && hook.enabled && hook.trustStatus === "trusted");
  if (studio.length !== studioHookCount)
    throw new AgentLaunchError("config_conflict", "Codex did not trust the studio's own hooks, so the session could not be watched.");
}
