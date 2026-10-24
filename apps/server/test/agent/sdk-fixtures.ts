// Created by The Angelo Umali.
// Minimal SDK messages for tests; the real types carry many fields the server never reads.
import type { SDKMessage, SDKSystemMessage } from "@anthropic-ai/claude-agent-sdk";
import { STUDIO_TOOL_NAMES, type ApprovalFacts } from "@zks/shared";

export const SDK_SESSION_ID = "sdk-session-1";
export const REQUIRED_SKILLS = ["zkidz-studio:edit-video"];

/** Stands in for the server's describeStudioGate where a test needs a card but no project files. */
export function stubGateFacts(tool: string): Promise<ApprovalFacts> {
  return Promise.resolve({ action: `Run ${tool}`, outputPaths: [], filesToDelete: [] });
}

export function sdkMessage(fields: Record<string, unknown>): SDKMessage {
  return { uuid: crypto.randomUUID(), session_id: SDK_SESSION_ID, ...fields } as unknown as SDKMessage;
}

export function initMessage(overrides: Partial<Record<keyof SDKSystemMessage, unknown>> = {}): SDKSystemMessage {
  return sdkMessage({
    type: "system",
    subtype: "init",
    apiKeySource: "ANTHROPIC_API_KEY",
    claude_code_version: "2.1.300",
    cwd: "/projects/p1",
    tools: ["Read", "Skill", "AskUserQuestion", ...STUDIO_TOOL_NAMES],
    mcp_servers: [{ name: "studio", status: "connected" }],
    model: "claude-haiku-4-5",
    permissionMode: "default",
    slash_commands: [],
    output_style: "default",
    skills: [...REQUIRED_SKILLS, "other-skill"],
    plugins: [
      { name: "zkidz-studio", path: "/plugin", source: "zkidz-studio@inline" },
      { name: "frontend", path: "/builtin/frontend", source: "frontend@builtin" },
    ],
    ...overrides,
  }) as SDKSystemMessage;
}

export function resultMessage(overrides: Record<string, unknown> = {}): SDKMessage {
  return sdkMessage({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 2,
    duration_ms: 1500,
    duration_api_ms: 1200,
    total_cost_usd: 0.0123,
    result: "done",
    stop_reason: "end_turn",
    usage: {},
    modelUsage: {},
    permission_denials: [],
    ...overrides,
  });
}

export function textDelta(text: string): SDKMessage {
  return sdkMessage({ type: "stream_event", parent_tool_use_id: null, event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } } });
}
