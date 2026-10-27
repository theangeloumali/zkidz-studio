// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { SdkEventMapper } from "../../src/agent/mapper.ts";
import { classifySessionError } from "../../src/agent/session-errors.ts";
import { initMessage, resultMessage, sdkMessage, textDelta } from "./sdk-fixtures.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

describe("SdkEventMapper", () => {
  it("maps init to session.started with the credential source and skills", () => {
    expect(new SdkEventMapper(PROJECT_ID).map(initMessage())).toEqual([
      {
        type: "session.started",
        projectId: PROJECT_ID,
        sessionId: "sdk-session-1",
        model: "claude-haiku-4-5",
        credential: "ANTHROPIC_API_KEY",
        skills: ["zkidz-studio:edit-video", "other-skill"],
      },
    ]);
  });

  it("maps streamed text and tool starts", () => {
    const mapper = new SdkEventMapper(PROJECT_ID);
    const toolStart = sdkMessage({
      type: "stream_event",
      parent_tool_use_id: null,
      event: { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu1", name: "mcp__studio__transcribe", input: {} } },
    });
    expect([...mapper.map(textDelta("Hello")), ...mapper.map(toolStart)]).toEqual([
      { type: "text.delta", projectId: PROJECT_ID, text: "Hello" },
      { type: "tool.started", projectId: PROJECT_ID, toolUseId: "tu1", name: "mcp__studio__transcribe" },
    ]);
  });

  it("maps a completed tool_use block to tool.called and its result to tool.finished", () => {
    const mapper = new SdkEventMapper(PROJECT_ID);
    const assistant = sdkMessage({
      type: "assistant",
      parent_tool_use_id: null,
      message: { content: [{ type: "tool_use", id: "tu1", name: "mcp__studio__render_preview", input: { target: "full" } }] },
    });
    const toolResult = sdkMessage({
      type: "user",
      parent_tool_use_id: null,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tu1", is_error: true, content: [{ type: "text", text: "x".repeat(500) }] }] },
    });

    const [called] = mapper.map(assistant);
    const [finished] = mapper.map(toolResult);

    expect(called).toEqual({
      type: "tool.called",
      projectId: PROJECT_ID,
      toolUseId: "tu1",
      name: "mcp__studio__render_preview",
      label: "render preview",
      input: { target: "full" },
    });
    expect(finished).toMatchObject({ type: "tool.finished", toolUseId: "tu1", ok: false });
    expect(finished?.type === "tool.finished" && finished.summary.length).toBeLessThanOrEqual(200);
  });

  it("maps retries, limits, compaction and turn results", () => {
    const mapper = new SdkEventMapper(PROJECT_ID);
    const events = [
      sdkMessage({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: "overloaded" }),
      sdkMessage({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: 1_800_000_000, utilization: 0.9 } }),
      sdkMessage({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: "auto", pre_tokens: 100 } }),
      resultMessage(),
    ].flatMap((message) => mapper.map(message));

    expect(events).toEqual([
      { type: "retry", projectId: PROJECT_ID, attempt: 1, max: 10, delayMs: 500, reason: "overloaded" },
      { type: "limit", projectId: PROJECT_ID, status: "allowed_warning", resetsAt: "2027-01-15T08:00:00.000Z", utilization: 0.9 },
      { type: "context.compacted", projectId: PROJECT_ID },
      { type: "turn.completed", projectId: PROJECT_ID, subtype: "success", isError: false, costUsd: 0.0123, numTurns: 2, durationMs: 1500 },
    ]);
  });

  it("adds a classified session.error after a failed turn", () => {
    const mapper = new SdkEventMapper(PROJECT_ID);
    mapper.map(
      sdkMessage({ type: "system", subtype: "api_retry", attempt: 1, max_retries: 1, retry_delay_ms: 0, error_status: 401, error: "authentication_failed" }),
    );
    const events = mapper.map(resultMessage({ subtype: "error_during_execution", is_error: true, errors: ["boom"] }));
    expect(events[1]).toMatchObject({ type: "session.error", kind: "auth_failed" });
  });

  it("ignores messages the UI has no event for", () => {
    expect(new SdkEventMapper(PROJECT_ID).map(sdkMessage({ type: "system", subtype: "status", status: null }))).toEqual([]);
  });
});

describe("classifySessionError", () => {
  it("prefers the api_retry error, then the result status, then known strings", () => {
    expect(classifySessionError({ retryError: "billing_error", apiErrorStatus: 401, text: "" })).toBe("billing_error");
    expect(classifySessionError({ apiErrorStatus: 429, text: "" })).toBe("rate_limited");
    expect(classifySessionError({ apiErrorStatus: 404, text: "" })).toBe("model_not_found");
    expect(classifySessionError({ text: "Your credit balance is too low" })).toBe("billing_error");
    expect(classifySessionError({ text: "Invalid API key · Please run /login" })).toBe("auth_failed");
    expect(classifySessionError({ subtype: "error_max_turns", text: "" })).toBe("max_turns");
    expect(classifySessionError({ subtype: "error_max_budget_usd", text: "" })).toBe("max_budget");
    expect(classifySessionError({ text: "something else" })).toBe("unknown");
  });
});
