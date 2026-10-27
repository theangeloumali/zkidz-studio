// Created by The Angelo Umali.
// The studio catalog both MCP servers serve: the in-process SDK server and the stdio twin.
import type { StudioTool } from "./define-tool.ts";
import { approveTool } from "./handlers/approve-tool.ts";
import { assetTools } from "./handlers/asset-tools.ts";
import { captionReelTools } from "./handlers/caption-reel-tools.ts";
import { cueTools } from "./handlers/cue-tools.ts";
import { cutTools } from "./handlers/cut-tools.ts";
import { jobTools } from "./handlers/job-tools.ts";
import { mediaCheckTools } from "./handlers/media-check-tools.ts";
import { previewTools } from "./handlers/preview-tools.ts";
import { projectTools } from "./handlers/project-tools.ts";
import { renderTools } from "./render-tools.ts";

export { implementTool, type StudioTool } from "./define-tool.ts";

/** Every STUDIO_TOOLS entry but `approve`, which only the twin serves. */
export function studioToolCatalog(): readonly StudioTool[] {
  return [...projectTools, ...jobTools, ...mediaCheckTools, ...cutTools, ...cueTools, ...captionReelTools, ...previewTools, ...renderTools, ...assetTools];
}

/** What the stdio twin serves: the catalog plus `approve`, the `claude -p` fallback's --permission-prompt-tool (plan §6.7). */
export function studioTwinCatalog(): readonly StudioTool[] {
  return [...studioToolCatalog(), approveTool];
}

export const STUDIO_TOOLS_BY_NAME: ReadonlyMap<string, StudioTool> = new Map(studioToolCatalog().map((studioTool) => [studioTool.name, studioTool]));
