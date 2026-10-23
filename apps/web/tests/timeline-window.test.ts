// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { indexTimelineItems, visibleItems } from "../src/editor/timeline-window.ts";

describe("visibleItems", () => {
  it("returns only the items that overlap the window", () => {
    const index = indexTimelineItems([
      { id: "c", at: 20, end: 22 },
      { id: "a", at: 0, end: 1 },
      { id: "b", at: 5, end: 6 },
    ]);
    expect(visibleItems(index, 4, 10).map((item) => item.id)).toEqual(["b"]);
  });

  it("keeps a long item that starts before the window and runs into it", () => {
    const index = indexTimelineItems([
      { id: "long", at: 0, end: 50 },
      { id: "short", at: 1, end: 2 },
      { id: "late", at: 60, end: 61 },
    ]);
    expect(visibleItems(index, 30, 40).map((item) => item.id)).toEqual(["long"]);
  });

  it("slices 2,000 items down to the window", () => {
    const items = Array.from({ length: 2000 }, (_unused, position) => ({ id: String(position), at: position, end: position + 0.5 }));
    const visible = visibleItems(indexTimelineItems(items), 100, 110);
    expect(visible).toHaveLength(11);
    expect(visible[0]?.id).toBe("100");
  });
});
