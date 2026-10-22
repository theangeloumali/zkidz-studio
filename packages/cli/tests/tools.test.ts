// Created by The Angelo Umali.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ZksContext } from "../src/context.ts";
import { loadToolsLock } from "../src/lock.ts";
import { PLATFORM_KEYS, type PlatformKey } from "../src/platform.ts";
import { chromeDownloadUrl, installTool, toolExecutablePath } from "../src/tools.ts";

function contextFor(platform: PlatformKey): ZksContext {
  const home = mkdtempSync(path.join(tmpdir(), "zks-tools-"));
  return { home, toolsDir: path.join(home, "tools"), modelsDir: path.join(home, "models"), platform, lock: loadToolsLock() };
}

describe("tool resolution", () => {
  it("places extracted tools under a hash-named directory in ZKS_HOME", () => {
    const context = contextFor("linux-x64");
    expect(toolExecutablePath(context, "whisper-cpp")).toBe(
      path.join(context.toolsDir, "whisper-cpp", "a72becf15d79", "whisper-bin-ubuntu-x64", "whisper-cli"),
    );
  });

  it.each(PLATFORM_KEYS.filter((key) => key !== "win-arm64"))("pins the chrome URL @puppeteer/browsers resolves on %s", (platform) => {
    const context = contextFor(platform);
    expect(context.lock.tools["chrome-headless-shell"].platforms[platform]).toMatchObject({ url: chromeDownloadUrl(context) });
  });

  it("refuses a lock URL that drifts from @puppeteer/browsers before touching the network", async () => {
    const context = contextFor("linux-x64");
    await expect(
      installTool({ ...context, lock: withChromeUrl(context, "linux-x64", "https://example.invalid/x.zip") }, "chrome-headless-shell"),
    ).rejects.toThrow(/differs from @puppeteer\/browsers/);
  });

  it("names the missing platform instead of guessing a build", async () => {
    await expect(installTool(contextFor("win-arm64"), "chrome-headless-shell")).rejects.toThrow(/no pinned build for win-arm64/);
  });
});

function withChromeUrl(context: ZksContext, platform: PlatformKey, url: string): ZksContext["lock"] {
  const chrome = context.lock.tools["chrome-headless-shell"];
  const entry = chrome.platforms[platform];
  if (!entry || !("url" in entry)) throw new Error("test setup: no chrome entry");
  return {
    ...context.lock,
    tools: { ...context.lock.tools, "chrome-headless-shell": { ...chrome, platforms: { ...chrome.platforms, [platform]: { ...entry, url } } } },
  };
}
