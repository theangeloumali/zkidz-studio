// Created by The Angelo Umali.
import type { CutSpec } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { buildTimelineTracks } from "../src/editor/timeline-items.ts";

const CUTS: CutSpec = {
  schemaVersion: 1,
  sourceAssetId: "asset-1",
  durationS: 30,
  fps: { num: 30000, den: 1001 },
  removals: [{ at: 4, end: 6, reason: "Filler" }],
  bleeps: [{ at: 10, end: 10.4, x: 540, y: 960 }],
  zooms: [{ at: 12, end: 14, preset: "snap" }],
};

describe("buildTimelineTracks", () => {
  it("lays shots, cuts and punch-ins on the video track and bleeps on audio", () => {
    const tracks = buildTimelineTracks(CUTS, []);
    expect(tracks.video.map((block) => [block.variant, block.at, block.end])).toEqual([
      ["seg", 0, 4],
      ["seg", 6, 30],
      ["cut", 4, 6],
      ["punch", 12, 14],
    ]);
    expect(tracks.audio).toEqual([expect.objectContaining({ variant: "sfx", at: 10, end: 10.4 })]);
  });

  it("splits caption cues from the other cues", () => {
    const tracks = buildTimelineTracks(CUTS, [
      { kind: "caption", at: 1, end: 3, text: "Hello there" },
      { kind: "keyword", at: 2, end: 4, text: "Claude" },
    ]);
    expect(tracks.captions.map((block) => block.label)).toEqual(["Hello there"]);
    expect(tracks.cues.map((block) => block.label)).toEqual(["keyword · Claude"]);
  });

  it("shows nothing but an empty lane before the first cut spec", () => {
    const tracks = buildTimelineTracks(null, []);
    expect(Object.values(tracks).flat()).toEqual([]);
  });
});
