// Created by The Angelo Umali.
// The MCP twin's paths, in a leaf module: the request guard reads them at load, and tools/routes.ts reaches the guard.
import { API_ROUTES, LOOPBACK_HOST } from "@zks/shared";

export const STUDIO_MCP_ROUTES = { listTools: "/api/mcp/:sessionId/tools", callTool: "/api/mcp/:sessionId/call" } as const;

/** Where a terminal session's hooks post; the route is the shared terminalHooks path. */
export function terminalHookUrl(appPort: number, sessionId: string): string {
  return `http://${LOOPBACK_HOST}:${appPort}${API_ROUTES.terminalHooks.path.replace(":sessionId", sessionId)}`;
}

/** The twin's ZKS_MCP_URL: it appends `/tools` and `/call`. */
export function studioMcpUrl(appPort: number, sessionId: string): string {
  return `http://127.0.0.1:${appPort}/api/mcp/${encodeURIComponent(sessionId)}`;
}
