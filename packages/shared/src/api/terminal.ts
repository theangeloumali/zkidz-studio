// Created by The Angelo Umali.
// Mode T wiring (plan §6.3): the PTY WebSocket ticket and the HTTP hooks bridge.
import { z } from "zod";
import { IdSchema, IsoTimestampSchema } from "../primitives.ts";

/** A ticket comes from a CSRF-checked POST, works once and expires after this. */
export const TERMINAL_TICKET_TTL_S = 30;

/** The open (or reattached) PTY; its id is also the hooks bridge and MCP twin path segment. */
export const OpenTerminalResponseSchema = z.strictObject({ sessionId: IdSchema });

export const TerminalTicketSchema = z.strictObject({ ticket: z.string().min(32), expiresAt: IsoTimestampSchema });
export const TerminalSocketQuerySchema = z.strictObject({ ticket: z.string().min(32) });

/** SessionStart reaches the bridge only through the command-hook relay: Claude Code skips an `http` SessionStart hook silently (spike 07). */
export const HOOK_EVENT_NAMES = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "Notification", "SessionStart", "MessageDisplay"] as const;
/** Not a Claude Code hook: zks-hook.mjs wraps the status-line JSON in this name so it reaches the same bearer route. */
export const STATUS_LINE_EVENT_NAME = "StatusLine";

// Claude Code owns these payloads and adds fields over time, so they are loose: unknown keys pass through.
const hookPayloadShape = { session_id: z.string().min(1), cwd: z.string().optional(), permission_mode: z.string().optional() };

export const PreToolUseHookPayloadSchema = z.looseObject({
  ...hookPayloadShape,
  hook_event_name: z.literal("PreToolUse"),
  tool_name: z.string().min(1),
  tool_input: z.unknown(),
});

export const HookPayloadSchema = z.discriminatedUnion("hook_event_name", [
  PreToolUseHookPayloadSchema,
  z.looseObject({
    ...hookPayloadShape,
    hook_event_name: z.literal("PostToolUse"),
    tool_name: z.string().min(1),
    tool_input: z.unknown(),
    tool_response: z.unknown(),
  }),
  z.looseObject({ ...hookPayloadShape, hook_event_name: z.literal("UserPromptSubmit"), prompt: z.string() }),
  z.looseObject({ ...hookPayloadShape, hook_event_name: z.literal("Stop"), last_assistant_message: z.string().optional() }),
  z.looseObject({ ...hookPayloadShape, hook_event_name: z.literal("Notification"), message: z.string().optional() }),
  z.looseObject({ ...hookPayloadShape, hook_event_name: z.literal("SessionStart"), source: z.string().optional(), model: z.string().optional() }),
  // One batch of newly completed lines while an assistant message streams; `final` marks the message's last batch.
  z.looseObject({
    ...hookPayloadShape,
    hook_event_name: z.literal("MessageDisplay"),
    delta: z.string(),
    final: z.boolean().optional(),
    index: z.int().nonnegative().optional(),
    message_id: z.string().optional(),
    turn_id: z.string().optional(),
  }),
  // Cost and duration are session totals; context_window is the latest API call only (statusline docs).
  z.looseObject({
    ...hookPayloadShape,
    hook_event_name: z.literal(STATUS_LINE_EVENT_NAME),
    cost: z.looseObject({ total_cost_usd: z.number().nonnegative().optional(), total_duration_ms: z.number().nonnegative().optional() }).optional(),
  }),
]);

/** Only PreToolUse answers with a decision; the other hooks, StatusLine included, get an empty object. */
export const HookResponseSchema = z.union([
  z.strictObject({
    hookSpecificOutput: z.strictObject({
      hookEventName: z.literal("PreToolUse"),
      permissionDecision: z.enum(["allow", "deny"]),
      permissionDecisionReason: z.string().optional(),
      /** With "allow": AskUserQuestion's input plus the user's `answers`, so the terminal dialog is skipped. */
      updatedInput: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.strictObject({}),
]);

export type HookPayload = z.infer<typeof HookPayloadSchema>;
export type HookResponse = z.infer<typeof HookResponseSchema>;
