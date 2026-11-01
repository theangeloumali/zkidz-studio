// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { formatBytes, formatDuration, formatMediaMeta, formatUsage } from "../src/lib/format.ts";
import { joinPath, parentPath } from "../src/lib/paths.ts";
import { makeAsset } from "./fakes.ts";

describe("format", () => {
  it("formats durations as m:ss or h:mm:ss", () => {
    expect(formatDuration(107)).toBe("1:47");
    expect(formatDuration(3725.4)).toBe("1:02:05");
  });

  it("formats byte counts in decimal units", () => {
    expect(formatBytes(1_500_000_000)).toBe("1.5 GB");
    expect(formatBytes(900)).toBe("900 B");
  });

  it("summarizes probe metadata", () => {
    expect(formatMediaMeta(makeAsset())).toBe("1:47 · 3840×2160 · 29.97 fps · HDR");
    expect(formatMediaMeta(makeAsset({ durationS: null, width: null, height: null, fps: null, isHdr: false }))).toBe("Reading metadata…");
  });

  it("counts cached input in the token total, since a cached session reads almost all of its input from the cache", () => {
    expect(formatUsage({ costUsd: 0.09, inputTokens: 12, outputTokens: 310, cacheTokens: 41_800 })).toBe("≈ $0.09 estimate · 42k tokens");
  });

  it("shows a total under a thousand tokens as it is", () => {
    expect(formatUsage({ inputTokens: 40, outputTokens: 310 })).toBe("350 tokens");
  });
});

describe("paths", () => {
  it("joins with the folder's own separator", () => {
    expect(joinPath("/media/clips", "a.mp4")).toBe("/media/clips/a.mp4");
    expect(joinPath("/", "a.mp4")).toBe("/a.mp4");
    expect(joinPath("C:\\Clips", "a.mp4")).toBe("C:\\Clips\\a.mp4");
  });

  it("finds the parent folder, or null at a root", () => {
    expect(parentPath("/media/clips")).toBe("/media");
    expect(parentPath("/media")).toBe("/");
    expect(parentPath("/")).toBeNull();
    expect(parentPath("C:\\Clips")).toBe("C:\\");
    expect(parentPath("C:\\")).toBeNull();
  });
});
