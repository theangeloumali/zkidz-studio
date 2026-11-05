// Created by The Angelo Umali.
import { CutCandidateSchema } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { findCutCandidates } from "../../src/tools/cut-candidates.ts";

const OPTIONS = { removeFillers: true, trimPauses: true, idPrefix: "test" };

describe("findCutCandidates", () => {
  // Whisper stamps some words with no length; on a 43-min session they made propose_cuts fail its contract (HTTP 500).
  it("offers no candidate without length, from a zero-length filler or a stutter repeated at the same instant", () => {
    const words = [
      { at: 1, end: 1, text: " um" },
      { at: 2, end: 2, text: " ship" },
      { at: 2, end: 2.4, text: " ship" },
      { at: 3, end: 3.5, text: " today" },
    ];

    const candidates = findCutCandidates(words, OPTIONS);

    expect(candidates.every((candidate) => CutCandidateSchema.safeParse(candidate).success)).toBe(true);
    expect(candidates.map((candidate) => candidate.kind)).toEqual(["pause"]);
  });

  it("still offers a filler and a stutter that have length", () => {
    const words = [
      { at: 1, end: 1.3, text: " um" },
      { at: 2, end: 2.4, text: " ship" },
      { at: 2.5, end: 2.9, text: " ship" },
    ];

    expect(findCutCandidates(words, OPTIONS).map((candidate) => candidate.kind)).toEqual(["filler", "stutter"]);
  });
});
