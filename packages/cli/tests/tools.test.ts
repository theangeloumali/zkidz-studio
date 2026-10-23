// Created by The Angelo Umali.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZksContext } from "../src/context.ts";
import { loadToolsLock, PLATFORM_KEYS, type PlatformKey } from "@zks/shared/node";
import { chromeDownloadUrl, installTool, tarExecutable, toolExecutablePath } from "../src/tools.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function contextFor(platform: PlatformKey): ZksContext {
  const home = mkdtempSync(path.join(tmpdir(), "zks-tools-"));
  homes.push(home);
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

  // The server and the HyperFrames renderer use an explicit ZKS_FFMPEG or ZKS_CHROME, so the doctor checks the same binary.
  it("resolves an explicit ZKS_FFMPEG or ZKS_CHROME ahead of the pinned build", () => {
    const context = contextFor("linux-x64");
    vi.stubEnv("ZKS_FFMPEG", "/opt/ffmpeg/bin/ffmpeg");
    vi.stubEnv("ZKS_CHROME", "/opt/chrome/chrome-headless-shell");
    try {
      expect(toolExecutablePath(context, "ffmpeg")).toBe("/opt/ffmpeg/bin/ffmpeg");
      expect(toolExecutablePath(context, "chrome-headless-shell")).toBe("/opt/chrome/chrome-headless-shell");
    } finally {
      vi.unstubAllEnvs();
    }
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

// Git Bash puts GNU tar first on PATH, which reads "D:\\..." as a remote host and fails `zks setup` on Windows.
describe("tarExecutable", () => {
  it("uses Windows' own bsdtar by absolute path, never the tar on PATH", () => {
    expect(tarExecutable("win32", { SystemRoot: "C:\\Windows" })).toBe(path.win32.join("C:\\Windows", "System32", "tar.exe"));
  });

  it("falls back to C:\\Windows when SystemRoot is unset", () => {
    expect(tarExecutable("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("uses tar from PATH on Linux and macOS", () => {
    expect(tarExecutable("linux", {})).toBe("tar");
    expect(tarExecutable("darwin", {})).toBe("tar");
  });
});
