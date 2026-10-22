// Created by The Angelo Umali.
// Mode T wiring (plan §6.3): the PTY WebSocket ticket and the HTTP hooks bridge.
import { z } from "zod";
import { IsoTimestampSchema } from "../primitives.ts";

/** A ticket comes from a CSRF-checked POST, works once and expires after this. */
export const TERMINAL_TICKET_TTL_S = 30;

export const TerminalTicketSchema = z.strictObject({ ticket: z.string().min(32), expiresAt: IsoTimestampSchema });
export const TerminalSocketQuerySchema = z.strictObject({ ticket: z.string().min(32) });

export const HOOK_EVENT_NAMES = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "Stop", "Notification", "SessionStart"] as const;

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
]);

/** Only PreToolUse answers with a decision; the other hooks get an empty object. */
export const HookResponseSchema = z.union([
  z.strictObject({
    hookSpecificOutput: z.strictObject({
      hookEventName: z.literal("PreToolUse"),
      permissionDecision: z.enum(["allow", "deny"]),
      permissionDecisionReason: z.string().optional(),
    }),
  }),
  z.strictObject({}),
]);

export type HookPayload = z.infer<typeof HookPayloadSchema>;
export type HookResponse = z.infer<typeof HookResponseSchema>;
