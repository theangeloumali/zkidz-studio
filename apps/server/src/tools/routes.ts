// Created by The Angelo Umali.
// The stdio twin's loopback API (plan §6.7): Claude Code in mode T reaches the same tools through bin/zks-mcp.mjs.
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { readJsonBody } from "../http/http-error.ts";
import { studioTwinCatalog, type StudioTool } from "./catalog.ts";
import type { ToolContext } from "./context.ts";
import { describeStudioGate } from "./gate-facts.ts";
import { STUDIO_MCP_ROUTES } from "./mcp-paths.ts";
import { toolErrorResult, ToolError } from "./result.ts";

export interface StudioToolSession {
  /** The per-session ZKS_MCP_TOKEN the PTY env carries. */
  readonly token: string;
  readonly context: ToolContext;
  /** False until SessionStart reaches the hooks bridge (plan §6.3). */
  readonly isReady: () => boolean;
}

export interface StudioToolRouteDeps {
  readonly findSession: (sessionId: string) => StudioToolSession | undefined;
  /** Kai's constant-time compare (security/token.ts). */
  readonly tokensMatch: (expected: string, presented: string | undefined) => boolean;
  readonly tools?: readonly StudioTool[];
}

const CallRequestSchema = z.strictObject({ name: z.string().min(1), arguments: z.unknown().optional() });
const BEARER_PREFIX = "Bearer ";

export function registerStudioToolRoutes(app: Hono, deps: StudioToolRouteDeps): void {
  const tools = deps.tools ?? studioTwinCatalog();
  const toolsByName = new Map<string, StudioTool>(tools.map((studioTool) => [studioTool.name, studioTool]));
  const listing = tools.map((studioTool) => ({
    name: studioTool.name,
    description: studioTool.description,
    inputSchema: z.toJSONSchema(studioTool.inputSchema, { io: "input" }),
    annotations: { readOnlyHint: studioTool.contract.isReadOnly },
  }));

  // Claude Code lists the tools before its SessionStart hook; the listing runs nothing, so only calls wait for the session.
  app.get(STUDIO_MCP_ROUTES.listTools, (c) => {
    const session = authorizedSession(c, deps, { mustBeReady: false });
    return session instanceof Response ? session : c.json({ tools: listing });
  });

  app.post(STUDIO_MCP_ROUTES.callTool, async (c) => {
    const session = authorizedSession(c, deps, { mustBeReady: true });
    if (session instanceof Response) return session;
    const request = CallRequestSchema.safeParse(await readJsonBody(c));
    if (!request.success) return c.json({ error: "Expected { name, arguments }" }, 400);
    const studioTool = toolsByName.get(request.data.name);
    if (studioTool === undefined) return c.json(toolErrorResult(`Unknown tool ${request.data.name}`));
    return c.json(await runWithGate(studioTool, { input: request.data.arguments ?? {}, context: session.context, signal: c.req.raw.signal }));
  });
}

function authorizedSession(c: Context, deps: StudioToolRouteDeps, { mustBeReady }: { mustBeReady: boolean }): StudioToolSession | Response {
  const session = deps.findSession(c.req.param("sessionId") ?? "");
  const authorization = c.req.header("authorization");
  const presentedToken = authorization?.startsWith(BEARER_PREFIX) ? authorization.slice(BEARER_PREFIX.length) : undefined;
  // An unknown session and a wrong token answer alike, so the route does not reveal which sessions exist.
  if (session === undefined || !deps.tokensMatch(session.token, presentedToken)) return c.json({ error: "Unauthorized" }, 401);
  if (mustBeReady && !session.isReady()) return c.json({ error: "The Claude Code session is not ready yet" }, 409);
  return session;
}

/** Mode T has no canUseTool, so gated tools wait for the user's approval card here. */
async function runWithGate(studioTool: StudioTool, call: { input: unknown; context: ToolContext; signal: AbortSignal }): Promise<CallToolResult> {
  if (studioTool.contract.approval === "gate") {
    const decision = await requestGateApproval(studioTool, call);
    if (decision !== "allow") return toolErrorResult(decision);
  }
  return studioTool.run(call.input, call.context, call.signal);
}

/** "allow", or the message Claude gets instead of running the tool. */
async function requestGateApproval(studioTool: StudioTool, call: { input: unknown; context: ToolContext; signal: AbortSignal }): Promise<string> {
  try {
    const facts = await describeStudioGate(call.context, studioTool.name, call.input);
    if (facts === null) return `Invalid input for ${studioTool.name}`;
    const decision = await call.context.requestApproval({ tool: studioTool.qualifiedName, facts }, call.signal);
    return decision === "allow" ? "allow" : `The user declined ${studioTool.name}`;
  } catch (error) {
    if (error instanceof ToolError) return error.message;
    throw error;
  }
}
