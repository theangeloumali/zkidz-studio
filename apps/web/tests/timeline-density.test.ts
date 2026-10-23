// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { isDensityRun, mergeDensityRuns } from "../src/editor/timeline-density.ts";
import type { TimelineBlock } from "../src/editor/timeline-items.ts";

const caption = (position: number, at: number, end: number): TimelineBlock => ({ id: `cap-${position}`, variant: "cap", at, end, label: `line ${position}` });
/** 84 captions 0.5 s long and 2 s apart from 12:04 on; under 2 px each at 0.5 px/s, a Fit-like zoom. */
const denseCaptions = Array.from({ length: 84 }, (_unused, position) => caption(position, 724 + position * 2, 724 + position * 2 + 0.5));

describe("mergeDensityRuns", () => {
  it("merges neighbours too thin to draw into one run named for its count and span", () => {
    const drawn = mergeDensityRuns(denseCaptions, 0.5, "captions");

    expect(drawn).toHaveLength(1);
    const [run] = drawn;
    expect(run !== undefined && isDensityRun(run)).toBe(true);
    expect(run).toMatchObject({ at: 724, end: 890.5, variant: "cap", runCount: 84, label: "84 captions, 12:04–14:51" });
  });

  it("draws every block alone when each is at least 2 px wide", () => {
    const drawn = mergeDensityRuns(denseCaptions, 40, "captions");

    expect(drawn).toEqual(denseCaptions);
  });

  it("starts a new run where thin neighbours sit 2 px or more apart", () => {
    const blocks = [caption(0, 0, 0.5), caption(1, 1, 1.5), caption(2, 100, 100.5), caption(3, 101, 101.5)];

    const drawn = mergeDensityRuns(blocks, 0.5, "captions");

    expect(drawn.map((block) => [block.at, block.end, isDensityRun(block) ? block.runCount : 1])).toEqual([
      [0, 1.5, 2],
      [100, 101.5, 2],
    ]);
  });

  it("keeps a lone thin block as itself, and never merges cut marks or sound effects", () => {
    const lone = caption(0, 50, 50.5);
    const cut: TimelineBlock = { id: "cut-0", variant: "cut", at: 10, end: 10.5, label: "um" };
    const bleep: TimelineBlock = { id: "sfx-0", variant: "sfx", at: 11, end: 11.5, label: "Bleep" };

    expect(mergeDensityRuns([lone, cut, bleep], 0.5, "items")).toEqual([cut, bleep, lone]);
  });
});
