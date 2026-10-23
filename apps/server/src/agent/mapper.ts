// Created by The Angelo Umali.
// SDK messages → StudioEvents (plan §6.11). The UI never sees a raw SDK message.
import type { SDKAssistantMessage, SDKAssistantMessageError, SDKMessage, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { NewStudioEvent } from "../events/event-bus.ts";
import { classifySessionError } from "./session-errors.ts";
import { toolLabel } from "./tool-names.ts";

const MAX_SUMMARY_CHARS = 200;
const MS_PER_SECOND = 1000;

type StreamEvent = Extract<SDKMessage, { type: "stream_event" }>["event"];

export class SdkEventMapper {
  readonly #projectId: string;
  #retryError: SDKAssistantMessageError | undefined;

  constructor(projectId: string) {
    this.#projectId = projectId;
  }

  map(message: SDKMessage): NewStudioEvent[] {
    const projectId = this.#projectId;
    switch (message.type) {
      case "stream_event":
        return this.#mapStreamEvent(message.event);
      case "assistant":
        return this.#mapToolCalls(message);
      case "user":
        return this.#mapToolResults(message);
      case "rate_limit_event": {
        const { status, resetsAt, utilization } = message.rate_limit_info;
        return [{ type: "limit", projectId, status, resetsAt: resetsAt === undefined ? undefined : toIso(resetsAt), utilization }];
      }
      case "result":
        return this.#mapResult(message);
      case "system":
        return this.#mapSystem(message);
      default:
        return [];
    }
  }

  #mapSystem(message: Extract<SDKMessage, { type: "system" }>): NewStudioEvent[] {
    const projectId = this.#projectId;
    switch (message.subtype) {
      case "init":
        return [
          { type: "session.started", projectId, sessionId: message.session_id, model: message.model, credential: message.apiKeySource, skills: message.skills },
        ];
      case "api_retry":
        this.#retryError = message.error;
        return [{ type: "retry", projectId, attempt: message.attempt, max: message.max_retries, delayMs: message.retry_delay_ms, reason: message.error }];
      case "compact_boundary":
        return [{ type: "context.compacted", projectId }];
      default:
        return [];
    }
  }

  #mapStreamEvent(event: StreamEvent): NewStudioEvent[] {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      return [{ type: "text.delta", projectId: this.#projectId, text: event.delta.text }];
    }
    if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
      return [{ type: "tool.started", projectId: this.#projectId, toolUseId: event.content_block.id, name: event.content_block.name }];
    }
    return [];
  }

  #mapToolCalls(message: SDKAssistantMessage): NewStudioEvent[] {
    return message.message.content.flatMap((block): NewStudioEvent[] =>
      block.type === "tool_use"
        ? [{ type: "tool.called", projectId: this.#projectId, toolUseId: block.id, name: block.name, label: toolLabel(block.name), input: block.input }]
        : [],
    );
  }

  #mapToolResults(message: SDKUserMessage): NewStudioEvent[] {
    const { content } = message.message;
    if (typeof content === "string") return [];
    return content.flatMap((block): NewStudioEvent[] =>
      block.type === "tool_result"
        ? [{ type: "tool.finished", projectId: this.#projectId, toolUseId: block.tool_use_id, ok: block.is_error !== true, summary: summarize(block.content) }]
        : [],
    );
  }

  #mapResult(message: SDKResultMessage): NewStudioEvent[] {
    const projectId = this.#projectId;
    const completed: NewStudioEvent = {
      type: "turn.completed",
      projectId,
      subtype: message.subtype,
      isError: message.is_error,
      costUsd: message.total_cost_usd,
      numTurns: message.num_turns,
      durationMs: message.duration_ms,
    };
    const retryError = this.#retryError;
    this.#retryError = undefined;
    if (!message.is_error) return [completed];
    const text = message.subtype === "success" ? message.result : message.errors.join("\n");
    const apiErrorStatus = "api_error_status" in message ? message.api_error_status : undefined;
    const kind = classifySessionError({ subtype: message.subtype, retryError, apiErrorStatus, text });
    return [completed, { type: "session.error", projectId, kind, message: text.trim() === "" ? "The turn failed" : text }];
  }
}

type ToolResultContent = Extract<Exclude<SDKUserMessage["message"]["content"], string>[number], { type: "tool_result" }>["content"];

function summarize(content: ToolResultContent): string {
  if (content === undefined) return "";
  const text = typeof content === "string" ? content : content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(" ");
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS - 1)}…` : text;
}

function toIso(epochSeconds: number): string {
  return new Date(epochSeconds * MS_PER_SECOND).toISOString();
}
