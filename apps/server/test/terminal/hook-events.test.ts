// Created by The Angelo Umali.
import type { HookPayload } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { hookToStudioEvents, SIGN_IN_CREDENTIAL } from "../../src/terminal/hook-events.ts";

const PROJECT_ID = "0b6f4f0e-7f43-4d8f-9a3c-5c9d7c1f2e11";
const SESSION_ID = "6f1c2a52-1d0c-4c3e-9a51-2b7f0f6f9f10";
const context = { projectId: PROJECT_ID, model: "haiku", isCatalogTool: false };
const base = { session_id: SESSION_ID };

function eventsFor(payload: HookPayload, overrides: Partial<Parameters<typeof hookToStudioEvents>[1]> = {}) {
  return hookToStudioEvents(payload, { ...context, ...overrides });
}

describe("hookToStudioEvents", () => {
  it("maps an allowed PreToolUse to tool.called and a denied one to tool.denied", () => {
    const payload: HookPayload = { ...base, hook_event_name: "PreToolUse", tool_name: "Read", tool_input: { file_path: "a" }, tool_use_id: "toolu_1" };
    expect(eventsFor(payload, { decision: { isAllowed: true } })).toEqual([
      { type: "tool.called", projectId: PROJECT_ID, toolUseId: "toolu_1", name: "Read", label: "Read", input: { file_path: "a" } },
    ]);
    expect(eventsFor({ ...payload, tool_name: "Bash" }, { decision: { isAllowed: false, reason: "no" } })).toEqual([
      { type: "tool.denied", projectId: PROJECT_ID, name: "Bash", reason: "no" },
    ]);
  });

  it("emits nothing for catalog tools, whose handler already reports them", () => {
    const payload: HookPayload = { ...base, hook_event_name: "PostToolUse", tool_name: "mcp__studio__render_preview", tool_input: {}, tool_response: {} };
    expect(eventsFor(payload, { isCatalogTool: true })).toEqual([]);
  });

  it("maps PostToolUse to tool.finished", () => {
    const payload: HookPayload = { ...base, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: {}, tool_response: {}, tool_use_id: "toolu_1" };
    expect(eventsFor(payload)).toEqual([{ type: "tool.finished", projectId: PROJECT_ID, toolUseId: "toolu_1", ok: true, summary: "Read finished" }]);
  });

  it("maps a typed prompt to prompt.submitted and the working state", () => {
    expect(eventsFor({ ...base, hook_event_name: "UserPromptSubmit", prompt: "trim the pause" })).toEqual([
      { type: "prompt.submitted", projectId: PROJECT_ID, text: "trim the pause" },
      { type: "terminal.state", projectId: PROJECT_ID, state: "working" },
    ]);
  });

  it("maps Stop to narration then ready, skipping empty narration", () => {
    expect(eventsFor({ ...base, hook_event_name: "Stop", last_assistant_message: "Done." })).toEqual([
      { type: "narration", projectId: PROJECT_ID, text: "Done." },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
    expect(eventsFor({ ...base, hook_event_name: "Stop" })).toEqual([{ type: "terminal.state", projectId: PROJECT_ID, state: "ready" }]);
  });

  it("maps Notification to the waiting state", () => {
    expect(eventsFor({ ...base, hook_event_name: "Notification", message: "Claude needs your permission" })).toEqual([
      { type: "terminal.state", projectId: PROJECT_ID, state: "waiting" },
    ]);
  });

  it("maps SessionStart to session.started with the user's own sign-in, then ready", () => {
    expect(eventsFor({ ...base, hook_event_name: "SessionStart", source: "startup", model: "claude-haiku" })).toEqual([
      { type: "session.started", projectId: PROJECT_ID, sessionId: SESSION_ID, model: "claude-haiku", credential: SIGN_IN_CREDENTIAL, skills: [] },
      { type: "terminal.state", projectId: PROJECT_ID, state: "ready" },
    ]);
    expect(eventsFor({ ...base, hook_event_name: "SessionStart" })[0]).toMatchObject({ model: "haiku" });
  });

  it('labels the model "default" when neither the hook nor the launch named one', () => {
    expect(eventsFor({ ...base, hook_event_name: "SessionStart" }, { model: undefined })[0]).toMatchObject({ model: "default" });
  });
});
