// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { keptSpansOf } from "../src/index.ts";

describe("keptSpansOf", () => {
  it("keeps the whole source when nothing is removed", () => {
    expect(keptSpansOf({ durationS: 30, removals: [] })).toEqual([{ at: 0, end: 30 }]);
  });

  it("merges overlapping removals and drops the gaps", () => {
    const removals = [
      { at: 12, end: 14, reason: "pause" },
      { at: 2, end: 4, reason: "pause" },
      { at: 13, end: 16, reason: "pause" },
    ];
    expect(keptSpansOf({ durationS: 30, removals })).toEqual([
      { at: 0, end: 2 },
      { at: 4, end: 12 },
      { at: 16, end: 30 },
    ]);
  });

  it("ends at the source end when a removal runs past it", () => {
    expect(keptSpansOf({ durationS: 10, removals: [{ at: 8, end: 12, reason: "pause" }] })).toEqual([{ at: 0, end: 8 }]);
  });
});
