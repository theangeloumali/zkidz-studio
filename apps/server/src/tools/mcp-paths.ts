// Created by The Angelo Umali.
// The MCP twin's paths, in a leaf module: the request guard reads them at load, and tools/routes.ts reaches the guard.
export const STUDIO_MCP_ROUTES = { listTools: "/api/mcp/:sessionId/tools", callTool: "/api/mcp/:sessionId/call" } as const;

/** The twin's ZKS_MCP_URL: it appends `/tools` and `/call`. */
export function studioMcpUrl(appPort: number, sessionId: string): string {
  return `http://127.0.0.1:${appPort}/api/mcp/${encodeURIComponent(sessionId)}`;
}
