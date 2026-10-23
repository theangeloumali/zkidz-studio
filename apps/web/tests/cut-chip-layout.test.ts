// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { CHIP_MIN_WIDTH_PX, layoutCutChips } from "../src/editor/cut-chip-layout.ts";

describe("layoutCutChips", () => {
  it("keeps a chip at its cut when nothing overlaps it", () => {
    const boxes = layoutCutChips([{ id: "a", at: 10, end: 12 }], 40);
    expect(boxes.get("a")).toEqual({ left: 400, width: 80 });
  });

  it("slides a chip right past a widened short chip, so neither covers the other's buttons", () => {
    // A 0.3 s filler at Fit is far narrower than its two buttons; the pause after it starts inside its min width.
    const boxes = layoutCutChips(
      [
        { id: "pause", at: 1.5, end: 3 },
        { id: "filler", at: 1.1, end: 1.4 },
      ],
      20,
    );
    const filler = boxes.get("filler");
    const pause = boxes.get("pause");
    expect(filler).toEqual({ left: 22, width: CHIP_MIN_WIDTH_PX });
    expect(pause?.left).toBeGreaterThanOrEqual(22 + CHIP_MIN_WIDTH_PX);
  });
});
