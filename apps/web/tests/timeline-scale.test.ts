// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import {
  LABEL_WIDTH_PX,
  MAX_PIXELS_PER_SECOND,
  anchoredScrollLeft,
  blockLod,
  clampZoom,
  fitPixelsPerSecond,
  followScrollLeft,
  rulerTicks,
  rulerTickStepS,
} from "../src/editor/timeline-scale.ts";

describe("fitPixelsPerSecond", () => {
  it("fits the whole edit in the lane width", () => {
    expect(fitPixelsPerSecond(1200, 600)).toBe(2);
  });

  it("never fits past 40 px/s, so a short edit has one zoom level", () => {
    expect(fitPixelsPerSecond(1200, 10)).toBe(MAX_PIXELS_PER_SECOND);
    expect(fitPixelsPerSecond(1200, 0)).toBe(MAX_PIXELS_PER_SECOND);
  });
});

describe("clampZoom", () => {
  it("keeps zoom between Fit and 40 px/s", () => {
    expect(clampZoom(80, 2)).toBe(40);
    expect(clampZoom(1, 2)).toBe(2);
    expect(clampZoom(10, 2)).toBe(10);
  });
});

describe("rulerTickStepS", () => {
  it("picks the smallest step that keeps ticks at least 64 px apart", () => {
    expect(rulerTickStepS(40)).toBe(2);
    expect(rulerTickStepS(64)).toBe(1);
    expect(rulerTickStepS(2)).toBe(60);
    expect(rulerTickStepS(4.3)).toBe(15);
  });

  it("stops at 600 s however far out the zoom is", () => {
    expect(rulerTickStepS(0.01)).toBe(600);
  });
});

describe("rulerTicks", () => {
  it("lists the ticks inside both the mounted window and the edit", () => {
    expect(rulerTicks({ startS: -20, endS: 9 }, 40, 30)).toEqual([0, 2, 4, 6, 8]);
    expect(rulerTicks({ startS: 20, endS: 100 }, 40, 25)).toEqual([20, 22, 24]);
  });
});

describe("blockLod", () => {
  it("shows a label from 48 px, hides it below, and drops ring and radius under 6 px", () => {
    expect(blockLod(48)).toBe("label");
    expect(blockLod(47.9)).toBe("bare");
    expect(blockLod(6)).toBe("bare");
    expect(blockLod(5.9)).toBe("sliver");
    expect(blockLod(2)).toBe("sliver");
  });
});

describe("anchoredScrollLeft", () => {
  it("keeps the anchored second under the same viewport x after a zoom", () => {
    const anchorS = 30;
    const offsetPx = 500;
    const scrollLeft = anchoredScrollLeft(anchorS, offsetPx, 20);
    expect(scrollLeft + offsetPx).toBe(LABEL_WIDTH_PX + anchorS * 20);
  });
});

describe("followScrollLeft", () => {
  it("jumps one lane width forward once the playhead passes the right edge, landing it just right of the labels", () => {
    expect(followScrollLeft(1001, 0, 1000)).toBe(1000 - LABEL_WIDTH_PX);
  });

  it("stays put while the playhead is in view or behind it", () => {
    expect(followScrollLeft(999, 0, 1000)).toBeNull();
    expect(followScrollLeft(10, 500, 1000)).toBeNull();
  });
});
