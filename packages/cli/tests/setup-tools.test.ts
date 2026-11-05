// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { loadToolsLock } from "@zks/shared/node";
import { setupTools } from "../src/setup.ts";

describe("setupTools", () => {
  const lock = loadToolsLock();

  // The CUDA whisper build re-hears QC's cuts about 12x faster; it is only fetched where it can run.
  it("adds the CUDA whisper build on linux-x64 with an NVIDIA driver", () => {
    expect(setupTools(lock, "linux-x64", true)).toEqual(["ffmpeg", "whisper-cpp", "chrome-headless-shell", "whisper-cuda"]);
  });

  it("leaves it out without a driver or where nothing is pinned for the platform", () => {
    expect(setupTools(lock, "linux-x64", false)).toEqual(["ffmpeg", "whisper-cpp", "chrome-headless-shell"]);
    expect(setupTools(lock, "mac-arm64", true)).toEqual(["ffmpeg", "whisper-cpp", "chrome-headless-shell"]);
  });
});
