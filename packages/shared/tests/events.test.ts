// Created by The Angelo Umali.
import { describe, expect, expectTypeOf, it } from "vitest";
import { EPHEMERAL_EVENT_TYPES, STUDIO_EVENT_TYPES, StudioEventSchema, type StudioEvent } from "../src/index.ts";
import { sampleEventByType } from "./event-samples.ts";

describe("StudioEventSchema (plan §6.11)", () => {
  it("has one valid sample per event type, and every sample parses", () => {
    expect(Object.keys(sampleEventByType).sort()).toEqual([...STUDIO_EVENT_TYPES].sort());
    for (const sampleEvent of Object.values(sampleEventByType)) {
      expect(StudioEventSchema.safeParse(sampleEvent).error?.issues ?? []).toEqual([]);
    }
  });

  it("rejects an unknown type", () => {
    expect(StudioEventSchema.safeParse({ ...sampleEventByType.resync, type: "agent.thinking" }).success).toBe(false);
  });

  it("rejects an event without a projectId", () => {
    const { projectId: _omitted, ...withoutProject } = sampleEventByType["text.delta"];

    expect(StudioEventSchema.safeParse(withoutProject).success).toBe(false);
  });

  it("rejects a job event with a status outside JobStatus", () => {
    expect(StudioEventSchema.safeParse({ ...sampleEventByType["job.queued"], status: "paused" }).success).toBe(false);
  });

  it("rejects a cut candidate of an unknown kind", () => {
    const badCandidate = { ...sampleEventByType["cuts.proposed"].candidates[0], kind: "boring" };

    expect(StudioEventSchema.safeParse({ ...sampleEventByType["cuts.proposed"], candidates: [badCandidate] }).success).toBe(false);
  });

  it("requires server-derived facts on an approval request", () => {
    const { facts: _omitted, ...withoutFacts } = sampleEventByType["approval.requested"];

    expect(StudioEventSchema.safeParse(withoutFacts).success).toBe(false);
  });

  it("rejects a progress percentage above 100", () => {
    expect(StudioEventSchema.safeParse({ ...sampleEventByType["job.progress"], pct: 140 }).success).toBe(false);
  });

  it("marks deltas and heartbeats as bus-only", () => {
    expect([...EPHEMERAL_EVENT_TYPES].sort()).toEqual(["text.delta", "tool.heartbeat"]);
  });

  it("narrows on type", () => {
    expectTypeOf<Extract<StudioEvent, { type: "spec.version" }>["author"]>().toEqualTypeOf<"agent" | "user" | "system">();
    expectTypeOf<Extract<StudioEvent, { type: "terminal.state" }>["state"]>().toEqualTypeOf<"starting" | "ready" | "working" | "waiting" | "exited">();
  });
});
