// Created by The Angelo Umali.
// The in-process `studio` MCP server for the SDK path (plan §6.6); canUseTool gates there, so no gate runs here.
import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { loadAgentSdk } from "../agent/sdk-loader.ts";
import { studioToolCatalog } from "./catalog.ts";
import type { ToolContext } from "./context.ts";

export type { ToolContext } from "./context.ts";
export { registerEngineJobHandlers, type EngineRunner } from "./engine-jobs.ts";
export { registerStudioToolRoutes } from "./routes.ts";
export { registerRenderJobHandlers } from "./render-tools.ts";

const STUDIO_MCP_SERVER_NAME = "studio";
const STUDIO_MCP_VERSION = "0.1.0";

/** Qualified names of the tools this server registers, for allowedTools and the init assertion. */
export const STUDIO_TOOL_NAMES: readonly string[] = studioToolCatalog().map((studioTool) => studioTool.qualifiedName);

export async function createStudioMcpServer(context: ToolContext): Promise<McpSdkServerConfigWithInstance> {
  const { createSdkMcpServer } = await loadAgentSdk();
  return createSdkMcpServer({
    name: STUDIO_MCP_SERVER_NAME,
    version: STUDIO_MCP_VERSION,
    tools: studioToolCatalog().map((studioTool) => ({
      name: studioTool.name,
      description: studioTool.description,
      inputSchema: studioTool.inputShape,
      annotations: { readOnlyHint: studioTool.contract.isReadOnly },
      handler: (input: unknown, extra: unknown) => studioTool.run(input, context, abortSignalOf(extra)),
    })),
  });
}

function abortSignalOf(extra: unknown): AbortSignal | undefined {
  if (typeof extra !== "object" || extra === null || !("signal" in extra)) return undefined;
  return extra.signal instanceof AbortSignal ? extra.signal : undefined;
}
