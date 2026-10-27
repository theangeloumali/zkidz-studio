// Created by The Angelo Umali.
import type { StudioEvent } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { DecisionBroker } from "../../src/agent/decisions.ts";
import type { NewStudioEvent } from "../../src/events/event-bus.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const APPROVAL_FACTS = {
  action: "Render the 4K master",
  target: "v1",
  quality: "4K HEVC",
  estimatedGpuMinutes: 6,
  outputPaths: ["out/v1.mp4"],
  filesToDelete: [],
};
const QUESTIONS = [{ question: "Which take?", header: "Take", options: [{ label: "A" }, { label: "B" }], multiSelect: false }];

function setup() {
  const published: NewStudioEvent[] = [];
  const broker = new DecisionBroker({
    publish: (event) => {
      published.push(event);
      return Promise.resolve({ ...event, at: new Date().toISOString() } as StudioEvent);
    },
  });
  const lastRequestId = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    const card = published.at(-1);
    if (card === undefined || !("requestId" in card)) throw new Error("no card published");
    return card.requestId;
  };
  return { published, broker, lastRequestId };
}

describe("DecisionBroker.askQuestions (the studio tools' ask_user and the SDK decider)", () => {
  it("publishes a question card and resolves to the user's answers", async () => {
    const { published, broker, lastRequestId } = setup();
    const pending = broker.askQuestions(PROJECT_ID, QUESTIONS);
    const requestId = await lastRequestId();

    expect(published.at(-1)).toMatchObject({ type: "question.asked", projectId: PROJECT_ID, questions: QUESTIONS });
    expect(broker.settle(PROJECT_ID, { kind: "approval", requestId, decision: "allow" })).toBe(false);
    expect(broker.settle(PROJECT_ID, { kind: "question", requestId, answers: { "Which take?": "B" } })).toBe(true);
    expect(await pending).toEqual({ "Which take?": "B" });
  });

  it("resolves to null when the project is stopped or the call aborts", async () => {
    const { broker, lastRequestId } = setup();
    const stopped = broker.askQuestions(PROJECT_ID, QUESTIONS);
    await lastRequestId();
    broker.cancelProject(PROJECT_ID);
    const aborted = new AbortController();
    const abandoned = broker.askQuestions(PROJECT_ID, QUESTIONS, aborted.signal);
    await lastRequestId();
    aborted.abort();

    expect(await stopped).toBeNull();
    expect(await abandoned).toBeNull();
  });
});

describe("DecisionBroker.pendingCards (replayed to a page that opens after the card was sent)", () => {
  it("lists each published card of the asked projects until it is settled", async () => {
    const { broker, lastRequestId } = setup();
    const otherProjectId = "00000000-0000-4000-8000-000000000002";
    const answered = broker.askQuestions(PROJECT_ID, QUESTIONS);
    const requestId = await lastRequestId();
    void broker.requestApproval(otherProjectId, { tool: "mcp__studio__render_master", facts: APPROVAL_FACTS });
    await lastRequestId();

    expect(broker.pendingCards([PROJECT_ID])).toMatchObject([{ type: "question.asked", projectId: PROJECT_ID, requestId }]);
    broker.settle(PROJECT_ID, { kind: "question", requestId, answers: { "Which take?": "A" } });
    await answered;

    expect(broker.pendingCards([PROJECT_ID])).toEqual([]);
    expect(broker.pendingCards([otherProjectId])).toMatchObject([{ type: "approval.requested" }]);
    broker.cancelProject(otherProjectId);
    expect(broker.pendingCards([otherProjectId])).toEqual([]);
  });
});
