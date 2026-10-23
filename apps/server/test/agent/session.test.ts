// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describe, expect, it, vi } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { createToolDecider } from "../../src/agent/policy.ts";
import { createAgentSession, type AgentSessionOptions } from "../../src/agent/session.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { initMessage, REQUIRED_SKILLS, resultMessage, textDelta } from "./sdk-fixtures.ts";
import { ScriptedQuery, settle } from "./scripted-query.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function setup(overrides: Partial<AgentSessionOptions> = {}) {
  const published: NewStudioEvent[] = [];
  const publish = (event: NewStudioEvent) => {
    published.push(event);
    return Promise.resolve({ ...event, at: new Date().toISOString() } as StudioEvent);
  };
  const broker = new DecisionBroker({ publish });
  const scripted = new ScriptedQuery();
  const cancelProjectJobs = vi.fn(() => Promise.resolve());
  const session = createAgentSession({
    projectId: PROJECT_ID,
    query: scripted.query,
    queryOptions: { cwd: "/projects/p1", maxTurns: 5 },
    publish,
    broker,
    expectations: { requiredSkills: REQUIRED_SKILLS, apiKeySource: "ANTHROPIC_API_KEY" },
    cancelProjectJobs,
    ...overrides,
  });
  const types = () => published.map((event) => event.type);
  const signal = () => scripted.calls[0]?.abortController?.signal;
  return { published, broker, scripted, session, cancelProjectJobs, types, signal };
}

describe("agent session", () => {
  it("streams prompts in and mapped events out once init matches", async () => {
    const { scripted, session, types } = setup();
    session.submit("Make a cut");
    scripted.emit(initMessage());
    scripted.emit(textDelta("On it"));
    scripted.emit(resultMessage());
    await settle();

    expect(scripted.prompts).toEqual(["Make a cut"]);
    expect(types()).toEqual(["session.started", "text.delta", "turn.completed"]);
    expect(scripted.calls[0]).toMatchObject({ cwd: "/projects/p1", maxTurns: 5 });
  });

  it("aborts with credential_mismatch when init reports the wrong credential source", async () => {
    const { scripted, session, published, signal } = setup();
    scripted.emit(initMessage({ apiKeySource: "none" }));
    expect(await session.done).toEqual({ kind: "failed" });
    expect(published).toEqual([expect.objectContaining({ type: "session.error", kind: "credential_mismatch" })]);
    expect(signal()?.aborted).toBe(true);
    expect(scripted.closes).toBe(1);
  });

  it("aborts on any other init drift before the first event reaches the UI", async () => {
    const { scripted, session, published } = setup();
    scripted.emit(initMessage({ tools: ["Read", "Skill", "AskUserQuestion", "Bash"] }));
    scripted.emit(textDelta("should never show"));
    expect(await session.done).toEqual({ kind: "failed" });
    expect(published).toEqual([expect.objectContaining({ type: "session.error", kind: "unknown" })]);
    expect(JSON.stringify(published[0])).toMatch(/unexpected tools: Bash/);
  });

  it("ends in auth_failed when no init arrives in time (mode B without credentials)", async () => {
    const { session, published, signal } = setup({ initTimeoutMs: 20 });
    expect(await session.done).toEqual({ kind: "failed" });
    expect(published).toEqual([expect.objectContaining({ type: "session.error", kind: "auth_failed" })]);
    expect(signal()?.aborted).toBe(true);
  });

  it("reports a missing SDK binary when the query fails before init", async () => {
    const { scripted, session, published } = setup();
    scripted.fail(new Error("Claude Code executable not found"));
    expect(await session.done).toEqual({ kind: "failed" });
    expect(published).toEqual([expect.objectContaining({ type: "session.error", kind: "sdk_binary_missing" })]);
  });

  it("reports a crash after init to the caller instead of the UI", async () => {
    const { scripted, session, types } = setup();
    scripted.emit(initMessage());
    scripted.fail(new Error("child exited"));
    expect(await session.done).toEqual({ kind: "crashed", sdkSessionId: "sdk-session-1" });
    expect(types()).toEqual(["session.started"]);
  });

  it("stop interrupts the turn, denies pending cards, cancels jobs and keeps the session usable", async () => {
    const { scripted, session, broker, cancelProjectJobs } = setup();
    scripted.emit(initMessage());
    await settle();
    const decide = createToolDecider({ projectId: PROJECT_ID, broker });
    const pending = decide(
      "mcp__studio__render_master",
      { target: "full", quality: "4k" },
      { signal: new AbortController().signal, toolUseID: "t", requestId: "r" },
    );
    await settle();

    await session.stop();
    session.submit("Try again");
    await settle();

    expect(scripted.interrupts).toBe(1);
    expect(cancelProjectJobs).toHaveBeenCalledWith(PROJECT_ID);
    expect(await pending).toMatchObject({ behavior: "deny" });
    expect(scripted.prompts).toEqual(["Try again"]);
  });

  it("kill aborts and closes the query", async () => {
    const { scripted, session, signal } = setup();
    scripted.emit(initMessage());
    await settle();
    session.kill();
    expect(await session.done).toEqual({ kind: "killed" });
    expect(signal()?.aborted).toBe(true);
    expect(scripted.closes).toBe(1);
  });
});
