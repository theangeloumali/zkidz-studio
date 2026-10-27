// Created by The Angelo Umali.
const STUDIO_TOOL_PREFIX = "mcp__studio__";

/** "mcp__studio__render_master" → "render_master"; other names pass through. */
export function bareToolName(toolName: string): string {
  return toolName.startsWith(STUDIO_TOOL_PREFIX) ? toolName.slice(STUDIO_TOOL_PREFIX.length) : toolName;
}

/** The activity-row label: "render_master" → "render master". */
export function toolLabel(toolName: string): string {
  return bareToolName(toolName).replaceAll("_", " ");
}
