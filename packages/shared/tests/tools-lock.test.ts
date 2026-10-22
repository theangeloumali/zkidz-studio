// Created by The Angelo Umali.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isDownload, loadToolsLock, parseToolsLock, pinnedExecutablePath, platformKey } from "../src/tools-lock.ts";

describe("tools.lock.json", () => {
  const lock = loadToolsLock();

  it("pins every download to https with a SHA-256 and size", () => {
    const pinnedDownloads = [...Object.values(lock.tools).flatMap((tool) => Object.values(tool.platforms).filter(isDownload)), ...Object.values(lock.models)];
    expect(pinnedDownloads.length).toBeGreaterThan(10);
    for (const entry of pinnedDownloads) {
      expect(entry.url).toMatch(/^https:\/\//);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.size).toBeGreaterThan(0);
    }
  });

  it("never pins a floating ffmpeg build or an unpinned model revision", () => {
    for (const entry of Object.values(lock.tools.ffmpeg.platforms).filter(isDownload))
      expect(entry.url).toMatch(/\/autobuild-\d{4}-\d{2}-\d{2}-[^/]+\/[^/]+-gpl-/);
    for (const model of Object.values(lock.models)) expect(model.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
  });

  it("fetches tiny and base on setup", () => {
    const setupModels = Object.entries(lock.models).filter(([, model]) => model.fetchOnSetup);
    expect(setupModels.map(([name]) => name).sort()).toEqual(["base", "tiny"]);
  });

  it("rejects a malformed hash", () => {
    expect(() => parseToolsLock({ ...lock, models: { tiny: { ...lock.models.tiny, sha256: "abc" } } })).toThrow();
  });
});

describe("platformKey", () => {
  it.each([
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["win32", "x64", "win-x64"],
    ["win32", "arm64", "win-arm64"],
    ["darwin", "arm64", "mac-arm64"],
  ] as const)("%s/%s maps to %s", (nodePlatform, arch, expected) => {
    expect(platformKey(nodePlatform, arch)).toBe(expected);
  });

  it("rejects an unsupported pair with the supported list", () => {
    expect(() => platformKey("darwin", "x64")).toThrow(/mac-arm64/);
  });
});

describe("pinnedExecutablePath", () => {
  const lock = loadToolsLock();

  it("places an extracted tool under a hash-named directory", () => {
    expect(pinnedExecutablePath({ toolsDir: "/z/tools", platform: "linux-x64", lock }, "whisper-cpp")).toBe(
      path.join("/z/tools", "whisper-cpp", "a72becf15d79", "whisper-bin-ubuntu-x64", "whisper-cli"),
    );
  });

  it("names the missing platform instead of guessing a build", () => {
    expect(() => pinnedExecutablePath({ toolsDir: "/z/tools", platform: "win-arm64", lock }, "chrome-headless-shell")).toThrow(/no pinned build for win-arm64/);
  });
});
