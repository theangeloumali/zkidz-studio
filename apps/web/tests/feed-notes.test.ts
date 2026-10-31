// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { describeNote, formatGpuMinutes } from "../src/agent/feed-notes.ts";
import { sampleEvent } from "./event-fixtures.ts";

describe("formatGpuMinutes", () => {
  it("says under a minute instead of rounding a short render to 0", () => {
    expect(formatGpuMinutes(0.03)).toBe("under 1 GPU minute");
  });

  it("is singular at one minute and plural above", () => {
    expect(formatGpuMinutes(1.2)).toBe("about 1 GPU minute");
    expect(formatGpuMinutes(6.4)).toBe("about 6 GPU minutes");
  });
});

// The feed cannot tell which agent runs, so its terminal notes name none.
describe("describeNote for the terminal", () => {
  it.each([
    ["starting", undefined, "The agent is starting."],
    ["ready", undefined, "The agent is ready."],
    ["working", undefined, "The agent is working."],
    ["waiting", undefined, "The agent is waiting for you."],
    ["exited", undefined, "The agent exited."],
    ["exited", 2, "The agent exited (code 2)."],
  ] as const)("%s (exit code %s) reads %j", (state, exitCode, text) => {
    const event = sampleEvent("terminal.state", { state });
    if (exitCode === undefined) delete event.exitCode;
    else event.exitCode = exitCode;
    expect(describeNote(event)?.text).toBe(text);
  });
});
