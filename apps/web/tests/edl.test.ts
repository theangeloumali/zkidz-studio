// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { keptSpansOf } from "@zks/shared";
import { editedDuration, editedToSource, sourceToEdited } from "../src/editor/edl.ts";

describe("time mapping", () => {
  const spans = keptSpansOf({ durationS: 30, removals: [{ at: 2, end: 4, reason: "pause" }] });

  it("sums the kept spans into the edited length", () => {
    expect(editedDuration(spans)).toBe(28);
  });

  it("maps source seconds onto the edit and back", () => {
    expect(sourceToEdited(spans, 1)).toBe(1);
    expect(sourceToEdited(spans, 5)).toBe(3);
    expect(editedToSource(spans, 3)).toBe(5);
  });

  it("snaps a removed source time to the next kept frame", () => {
    expect(sourceToEdited(spans, 3)).toBe(2);
  });

  it("clamps edited time to the edit's length", () => {
    expect(editedToSource(spans, 99)).toBe(30);
    expect(editedToSource(spans, -1)).toBe(0);
  });
});
