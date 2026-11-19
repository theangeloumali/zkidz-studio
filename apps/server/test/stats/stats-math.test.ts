// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { isoWeekOf, median } from "../../src/stats/stats-math.ts";

describe("isoWeekOf", () => {
  it.each([
    ["2026-11-19T12:00:00Z", "2026-W47"],
    ["2021-01-01T00:00:00Z", "2020-W53"],
    ["2024-12-30T00:00:00Z", "2025-W01"],
    ["2026-01-04T23:59:59Z", "2026-W01"],
  ])("puts %s in %s", (timestamp, week) => {
    expect(isoWeekOf(new Date(timestamp))).toBe(week);
  });
});

describe("median", () => {
  it("averages the middle pair of an even count and is null for none", () => {
    expect(median([40, 30, 90, 50])).toBe(45);
    expect(median([3, 1, 2])).toBe(2);
    expect(median([])).toBeNull();
  });
});
