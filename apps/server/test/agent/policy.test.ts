// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import { createToolDecider } from "../../src/agent/policy.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";
import { stubGateFacts } from "./sdk-fixtures.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";

function setup(describeGate: Parameters<typeof createToolDecider>[0]["describeGate"] = stubGateFacts) {
  const published: NewStudioEvent[] = [];
  const broker = new DecisionBroker({
    publish: (event) => {
      published.push(event);
      return Promise.resolve({ ...event, at: new Date().toISOString() } as StudioEvent);
    },
  });
  const canUseTool = createToolDecider({ projectId: PROJECT_ID, broker, describeGate });
  const signal = new AbortController().signal;
  const call = (toolName: string, input: Record<string, unknown>) => canUseTool(toolName, input, { signal, toolUseID: "tu1", requestId: "r1" });
  const nextRequestId = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    const card = published.at(-1);
    if (card === undefined || !("requestId" in card)) throw new Error("no card published");
    return card.requestId;
  };
  return { published, broker, call, nextRequestId };
}

describe("tool decider", () => {
  it("denies unknown and built-in mutating tools with a reason and no card", async () => {
    const { published, call } = setup();
    for (const toolName of ["Bash", "Write", "WebFetch", "mcp__other__tool"]) {
      expect(await call(toolName, {})).toMatchObject({ behavior: "deny" });
    }
    expect(published.map((event) => event.type)).toEqual(["tool.denied", "tool.denied", "tool.denied", "tool.denied"]);
  });

  it("allows auto studio tools and Skill without asking", async () => {
    const { published, call } = setup();
    expect(await call("mcp__studio__transcribe", {})).toEqual({ behavior: "allow", updatedInput: {} });
    expect(await call("Skill", { skill: "x" })).toEqual({ behavior: "allow", updatedInput: { skill: "x" } });
    expect(published).toEqual([]);
  });

  it("shows server facts for a gate tool and follows the user's decision", async () => {
    const { published, broker, call, nextRequestId } = setup();
    const pending = call("mcp__studio__render_master", { target: "full", quality: "final" });
    const requestId = await nextRequestId();

    expect(published.at(-1)).toMatchObject({
      type: "approval.requested",
      tool: "render_master",
      facts: { action: "Run render_master", outputPaths: [], filesToDelete: [] },
    });
    expect(broker.settle(PROJECT_ID, { kind: "approval", requestId, decision: "deny", message: "not yet" })).toBe(true);
    expect(await pending).toEqual({ behavior: "deny", message: "not yet" });
  });

  it("shows the project-aware facts when the session can derive them", async () => {
    const outputFacts = { action: "Render the 4K master", outputPaths: ["work/out/v1-4k.mp4"], filesToDelete: [], estimatedGpuMinutes: 1.5 };
    const { published, broker, call, nextRequestId } = setup((tool, input) => Promise.resolve(tool === "render_master" && input !== null ? outputFacts : null));
    const pending = call("mcp__studio__render_master", { target: "full", quality: "4k" });
    const requestId = await nextRequestId();

    expect(published.at(-1)).toMatchObject({ type: "approval.requested", facts: outputFacts });
    broker.settle(PROJECT_ID, { kind: "approval", requestId, decision: "allow" });
    expect(await pending).toMatchObject({ behavior: "allow" });
  });

  it("denies a gate call whose facts cannot be derived", async () => {
    const { call } = setup(() => Promise.reject(new Error("There is no asset x in this project")));
    expect(await call("mcp__studio__delete_asset", { assetId: "x" })).toEqual({ behavior: "deny", message: "The tool input was invalid" });
  });

  it("returns the user's answers to AskUserQuestion as updated input", async () => {
    const { published, broker, call, nextRequestId } = setup();
    const questions = [{ question: "Which take?", header: "Take", options: [{ label: "A" }, { label: "B" }], multiSelect: false }];
    const pending = call("AskUserQuestion", { questions });
    const requestId = await nextRequestId();

    expect(published.at(-1)).toMatchObject({ type: "question.asked", questions });
    broker.settle(PROJECT_ID, { kind: "question", requestId, answers: { "Which take?": "B" } });
    expect(await pending).toEqual({ behavior: "allow", updatedInput: { questions, answers: { "Which take?": "B" } } });
  });

  it("denies a pending card when the project is stopped", async () => {
    const { broker, call, nextRequestId } = setup();
    const pending = call("mcp__studio__delete_asset", { assetId: "00000000-0000-4000-8000-000000000009" });
    await nextRequestId();
    broker.cancelProject(PROJECT_ID);
    expect(await pending).toMatchObject({ behavior: "deny" });
  });

  it("rejects a decision for an unknown request or the wrong kind", async () => {
    const { broker, call, nextRequestId } = setup();
    void call("mcp__studio__export_deliverable", { kinds: ["full"] });
    const requestId = await nextRequestId();
    expect(broker.settle(PROJECT_ID, { kind: "approval", requestId: "nope", decision: "allow" })).toBe(false);
    expect(broker.settle(PROJECT_ID, { kind: "question", requestId, answers: {} })).toBe(false);
    expect(broker.settle(PROJECT_ID, { kind: "approval", requestId, decision: "allow" })).toBe(true);
  });
});
