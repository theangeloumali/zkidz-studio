// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { parseByteRange } from "../src/media-io/range.ts";

describe("parseByteRange", () => {
  it("returns null without a Range header", () => {
    expect(parseByteRange(undefined, 100)).toBeNull();
  });

  it("reads closed, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=0-9", 100)).toEqual({ start: 0, end: 9 });
    expect(parseByteRange("bytes=90-", 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange("bytes=-10", 100)).toEqual({ start: 90, end: 99 });
  });

  it("clamps an end past the file", () => {
    expect(parseByteRange("bytes=50-500", 100)).toEqual({ start: 50, end: 99 });
  });

  it("marks a start past the file unsatisfiable", () => {
    expect(parseByteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 100)).toBe("unsatisfiable");
  });

  it("ignores malformed or multi-range headers and serves the whole file", () => {
    expect(parseByteRange("bytes=9-0", 100)).toBeNull();
    expect(parseByteRange("items=0-1", 100)).toBeNull();
    expect(parseByteRange("bytes=0-1,5-6", 100)).toBeNull();
  });
});
