// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { formatGpuMinutes } from "../src/agent/feed-notes.ts";

describe("formatGpuMinutes", () => {
  it("says under a minute instead of rounding a short render to 0", () => {
    expect(formatGpuMinutes(0.03)).toBe("under 1 GPU minute");
  });

  it("is singular at one minute and plural above", () => {
    expect(formatGpuMinutes(1.2)).toBe("about 1 GPU minute");
    expect(formatGpuMinutes(6.4)).toBe("about 6 GPU minutes");
  });
});
