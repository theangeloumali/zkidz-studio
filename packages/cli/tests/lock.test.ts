// Created by The Angelo Umali.
import { describe, expect, it } from "vitest";
import { isDownload, loadToolsLock, parseToolsLock } from "../src/lock.ts";

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
