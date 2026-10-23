// Created by The Angelo Umali.
// Claude Code hook payloads → StudioEvents (plan §6.3 table); the TUI bytes are only displayed, never parsed.
import { randomUUID } from "node:crypto";
import type { HookPayload } from "@zks/shared";
import type { NewStudioEvent } from "../events/event-bus.ts";
import type { TerminalToolDecision } from "./hook-policy.ts";

/** Mode T never sees a credential; the session runs on whatever the user signed in with. */
export const SIGN_IN_CREDENTIAL = "your Claude Code sign-in";

export interface HookEventContext {
  readonly projectId: string;
  /** Reported when SessionStart omits the model. */
  readonly model: string;
  /** Catalog tool handlers emit their own events, so the hooks stay silent to avoid doubles. */
  readonly isCatalogTool: boolean;
  readonly decision?: TerminalToolDecision;
}

export function hookToStudioEvents(payload: HookPayload, context: HookEventContext): NewStudioEvent[] {
  const { projectId } = context;
  switch (payload.hook_event_name) {
    case "PreToolUse":
      if (context.isCatalogTool) return [];
      if (context.decision?.isAllowed === false) return [{ type: "tool.denied", projectId, name: payload.tool_name, reason: context.decision.reason }];
      return [
        { type: "tool.called", projectId, toolUseId: toolUseIdOf(payload), name: payload.tool_name, label: payload.tool_name, input: payload.tool_input },
      ];
    case "PostToolUse":
      if (context.isCatalogTool) return [];
      // Claude Code sends failures to PostToolUseFailure, so this hook only ever reports success.
      return [{ type: "tool.finished", projectId, toolUseId: toolUseIdOf(payload), ok: true, summary: `${payload.tool_name} finished` }];
    case "UserPromptSubmit":
      return [
        { type: "prompt.submitted", projectId, text: payload.prompt },
        { type: "terminal.state", projectId, state: "working" },
      ];
    case "Stop": {
      const narration = payload.last_assistant_message?.trim() ?? "";
      const readyEvent: NewStudioEvent = { type: "terminal.state", projectId, state: "ready" };
      return narration === "" ? [readyEvent] : [{ type: "narration", projectId, text: narration }, readyEvent];
    }
    case "Notification":
      return [{ type: "terminal.state", projectId, state: "waiting" }];
    case "SessionStart":
      return [
        {
          type: "session.started",
          projectId,
          sessionId: payload.session_id,
          model: payload.model ?? context.model,
          credential: SIGN_IN_CREDENTIAL,
          skills: [],
        },
        { type: "terminal.state", projectId, state: "ready" },
      ];
    default: {
      const unhandled: never = payload;
      return unhandled;
    }
  }
}

function toolUseIdOf(payload: Readonly<Record<string, unknown>>): string {
  return typeof payload.tool_use_id === "string" && payload.tool_use_id !== "" ? payload.tool_use_id : randomUUID();
}
