// Created by The Angelo Umali.
import { STUDIO_EVENT_TYPES, type StudioEvent } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { buildFeedItems, summarizeSession } from "../src/agent/feed-items.ts";
import { SAMPLE_EVENTS, sampleEvent } from "./event-fixtures.ts";

describe("buildFeedItems", () => {
  it("gives every event type except resync a feed entry", () => {
    const silentTypes = new Set(["resync"]);
    for (const type of STUDIO_EVENT_TYPES) {
      const items = buildFeedItems([SAMPLE_EVENTS[type]]);
      expect(items.length, type).toBe(silentTypes.has(type) ? 0 : 1);
    }
  });

  it("joins consecutive text deltas into one agent message", () => {
    const items = buildFeedItems([sampleEvent("text.delta", { text: "Cutting " }), sampleEvent("text.delta", { text: "the pauses." })]);
    expect(items).toEqual([expect.objectContaining({ kind: "agent", text: "Cutting the pauses." })]);
  });

  it("folds a tool's lifecycle into one entry keyed by its tool use id", () => {
    const items = buildFeedItems([
      SAMPLE_EVENTS["tool.started"],
      SAMPLE_EVENTS["tool.called"],
      SAMPLE_EVENTS["tool.heartbeat"],
      sampleEvent("tool.finished", { ok: false, summary: "ffprobe failed" }),
    ]);
    expect(items).toEqual([
      expect.objectContaining({
        kind: "tool",
        name: "mcp__studio__transcribe",
        label: "Transcribing beach.mp4",
        state: "failed",
        summary: "ffprobe failed",
        elapsedS: 12,
      }),
    ]);
  });

  it("folds a job's lifecycle into one entry with its latest progress", () => {
    const items = buildFeedItems([SAMPLE_EVENTS["job.queued"], SAMPLE_EVENTS["job.started"], SAMPLE_EVENTS["job.progress"]]);
    expect(items).toEqual([expect.objectContaining({ kind: "job", jobKind: "render", status: "running", progress: "encode 42% · about 2 min left" })]);
  });

  it("says when a rejected plan limit resets", () => {
    const [item] = buildFeedItems([sampleEvent("limit", { status: "rejected", resetsAt: "2026-10-23T15:00:00.000Z", utilization: 1 })]);
    expect(item).toEqual(expect.objectContaining({ kind: "note", tone: "warn" }));
    expect(item?.kind === "note" && item.text).toMatch(/^Plan limit reached\. Resets at /);
  });

  it("states the retry delay in seconds", () => {
    const [item] = buildFeedItems([SAMPLE_EVENTS.retry]);
    expect(item).toEqual(expect.objectContaining({ kind: "note", text: "Retrying in 12 s (attempt 1 of 3): overloaded" }));
  });
});

describe("summarizeSession", () => {
  it("reads the session id, latest cost, limit and working state", () => {
    const events: StudioEvent[] = [
      SAMPLE_EVENTS["session.started"],
      sampleEvent("turn.completed", { costUsd: 0.1 }),
      SAMPLE_EVENTS.limit,
      sampleEvent("prompt.submitted"),
      SAMPLE_EVENTS["tool.started"],
    ];
    expect(summarizeSession(events)).toEqual({ sessionId: "sess-1", turnCostUsd: 0.1, limit: SAMPLE_EVENTS.limit, isWorking: true });
  });

  it("is idle once the turn completes and keeps the latest cost, never a sum", () => {
    const events = [sampleEvent("turn.completed", { costUsd: 0.1 }), sampleEvent("prompt.submitted"), sampleEvent("turn.completed", { costUsd: 0.42 })];
    expect(summarizeSession(events)).toEqual(expect.objectContaining({ turnCostUsd: 0.42, isWorking: false }));
  });

  it("follows the terminal state in mode T", () => {
    expect(summarizeSession([sampleEvent("terminal.state", { state: "working" })]).isWorking).toBe(true);
    expect(summarizeSession([sampleEvent("terminal.state", { state: "ready" })]).isWorking).toBe(false);
    // Nothing has been sent while Claude Code starts, so there is nothing to stop.
    expect(summarizeSession([sampleEvent("terminal.state", { state: "starting" })]).isWorking).toBe(false);
  });
});
