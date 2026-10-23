// Created by The Angelo Umali.
// The init assertion (plan §6.10, spike 01): any drift from the locked-down session aborts it before the first turn.
import type { SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";

export const BASE_TOOLS = ["Read", "Skill", "AskUserQuestion"] as const;
/** Belt and braces on top of `tools`: these never load even if a setting re-enables them. */
export const DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "WebFetch", "WebSearch", "Agent"] as const;
const STUDIO_PLUGIN_SOURCE = "zkidz-studio@inline";
const STUDIO_MCP_SERVER = "studio";
const STUDIO_TOOL_PREFIX = `mcp__${STUDIO_MCP_SERVER}__`;
const BUILTIN_PLUGIN_SUFFIX = "@builtin";

export interface InitExpectations {
  readonly requiredSkills: readonly string[];
  /** "ANTHROPIC_API_KEY" in mode A, "none" in mode B. */
  readonly apiKeySource: string;
}

/** Returns why the init is unacceptable, or null. */
export function findInitMismatch(init: SDKSystemMessage, expected: InitExpectations): string | null {
  const checks = [
    listProblem(
      "missing tools",
      BASE_TOOLS.filter((tool) => !init.tools.includes(tool)),
    ),
    listProblem(
      "unexpected tools",
      init.tools.filter((tool) => !isExpectedTool(tool)),
    ),
    listProblem(
      "unexpected MCP servers",
      init.mcp_servers.map((server) => server.name).filter((name) => name !== STUDIO_MCP_SERVER),
    ),
    pluginProblem(init.plugins.map(pluginSource)),
    listProblem(
      "missing skills",
      expected.requiredSkills.filter((skill) => !init.skills.includes(skill)),
    ),
    init.permissionMode === "default" ? null : `permission mode is ${init.permissionMode}`,
    init.apiKeySource === expected.apiKeySource ? null : `credential source is ${init.apiKeySource}, expected ${expected.apiKeySource}`,
  ];
  return checks.find((problem) => problem !== null) ?? null;
}

function isExpectedTool(tool: string): boolean {
  return BASE_TOOLS.some((baseTool) => baseTool === tool) || tool.startsWith(STUDIO_TOOL_PREFIX);
}

function pluginProblem(sources: readonly string[]): string | null {
  if (!sources.includes(STUDIO_PLUGIN_SOURCE)) return `plugin ${STUDIO_PLUGIN_SOURCE} is not loaded`;
  return listProblem(
    "unexpected plugins",
    sources.filter((source) => source !== STUDIO_PLUGIN_SOURCE && !source.endsWith(BUILTIN_PLUGIN_SUFFIX)),
  );
}

// The runtime init carries `source` (spike 01) although the SDK type omits it.
function pluginSource(plugin: SDKSystemMessage["plugins"][number]): string {
  return "source" in plugin && typeof plugin.source === "string" ? plugin.source : plugin.name;
}

function listProblem(label: string, items: readonly string[]): string | null {
  return items.length === 0 ? null : `${label}: ${items.join(", ")}`;
}
