// Created by The Angelo Umali.
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ApprovalCardSchema,
  EPHEMERAL_EVENT_TYPES,
  JobSchema,
  JobSnapshotSchema,
  STUDIO_EVENT_TYPES,
  StudioEventSchema,
  type StudioEvent,
} from "../src/index.ts";
import { EVENT_AT, JOB_ID, PROJECT_ID } from "./fixtures.ts";
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

  it("carries job progress in one unit: a job.progress pct round-trips into JobSchema and the job snapshot", () => {
    const progressEvent = StudioEventSchema.parse(sampleEventByType["job.progress"]);
    if (progressEvent.type !== "job.progress") throw new Error("expected a job.progress sample");
    const jobRow = {
      id: JOB_ID,
      projectId: PROJECT_ID,
      kind: "render_master",
      videoId: "v1",
      lane: "gpu",
      status: "running",
      stage: progressEvent.stage,
      pct: progressEvent.pct,
      etaS: progressEvent.etaS,
      error: null,
      queuedAt: EVENT_AT,
      startedAt: EVENT_AT,
      finishedAt: null,
    };

    expect(JobSchema.parse(jobRow).pct).toBe(progressEvent.pct);
    expect(JobSnapshotSchema.parse({ jobId: JOB_ID, status: "running", pct: progressEvent.pct, logTail: [] }).pct).toBe(progressEvent.pct);
    expect(JobSchema.safeParse({ ...jobRow, pct: 140 }).success).toBe(false);
  });

  it("marks deltas and heartbeats as bus-only", () => {
    expect([...EPHEMERAL_EVENT_TYPES].sort()).toEqual(["text.delta", "tool.heartbeat"]);
  });

  it("narrows on type", () => {
    expectTypeOf<Extract<StudioEvent, { type: "spec.version" }>["author"]>().toEqualTypeOf<"agent" | "user" | "system">();
    expectTypeOf<Extract<StudioEvent, { type: "terminal.state" }>["state"]>().toEqualTypeOf<"starting" | "ready" | "working" | "waiting" | "exited">();
  });
});

describe("ApprovalCardSchema", () => {
  it("is the approval.requested payload minus its envelope, so the server and web share one card shape", () => {
    const { type: _type, id: _id, projectId: _projectId, at: _at, requestId: _requestId, ...card } = sampleEventByType["approval.requested"];

    expect(ApprovalCardSchema.parse(card)).toEqual(card);
    expect(ApprovalCardSchema.safeParse({ ...card, requestId: "a-1" }).success).toBe(false);
  });
});
