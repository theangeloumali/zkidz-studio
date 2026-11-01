// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { formatTokenCount } from "../src/token-count.ts";

describe("formatTokenCount", () => {
  it("rounds a thousand or more to the nearest k", () => {
    expect(formatTokenCount(210_400)).toBe("210k tokens");
    expect(formatTokenCount(1000)).toBe("1k tokens");
  });

  it("shows a count under a thousand as it is", () => {
    expect(formatTokenCount(350)).toBe("350 tokens");
  });
});
