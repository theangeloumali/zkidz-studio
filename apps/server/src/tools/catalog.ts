// Created by The Angelo Umali.
// The studio catalog both MCP servers serve: the in-process SDK server and the stdio twin.
import type { StudioTool } from "./define-tool.ts";
import { approveTool } from "./handlers/approve-tool.ts";
import { captionReelTools } from "./handlers/caption-reel-tools.ts";
import { cueTools } from "./handlers/cue-tools.ts";
import { cutTools } from "./handlers/cut-tools.ts";
import { jobTools } from "./handlers/job-tools.ts";
import { projectTools } from "./handlers/project-tools.ts";
import { renderTools } from "./render-tools.ts";

export { implementTool, type StudioTool } from "./define-tool.ts";

/** Phase 2 tools, Phase 4's cue, caption and reel tools and Phase 5's render tools; the rest of STUDIO_TOOLS lands with the phase that owns its engine step. */
export function studioToolCatalog(): readonly StudioTool[] {
  return [...projectTools, ...jobTools, ...cutTools, ...cueTools, ...captionReelTools, ...renderTools];
}

/** What the stdio twin serves: the catalog plus `approve`, the `claude -p` fallback's --permission-prompt-tool (plan §6.7). */
export function studioTwinCatalog(): readonly StudioTool[] {
  return [...studioToolCatalog(), approveTool];
}

export const STUDIO_TOOLS_BY_NAME: ReadonlyMap<string, StudioTool> = new Map(studioToolCatalog().map((studioTool) => [studioTool.name, studioTool]));
