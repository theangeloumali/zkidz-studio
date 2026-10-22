// Created by The Angelo Umali.
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { isDownload, loadToolsLock } from "@zks/cli/src/lock.ts";
import { platformKey } from "@zks/cli/src/platform.ts";
import { APP_PORT } from "@zks/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertFfprobeInstalled, defaultStudioHome, ensureStudioHome, loadServerConfig, STUDIO_HOME_DIRS } from "../src/config.ts";

let scratchDir = "";
afterEach(async () => {
  if (scratchDir) await rm(scratchDir, { recursive: true, force: true });
  scratchDir = "";
});

describe("defaultStudioHome", () => {
  it("follows each platform's per-user data folder (plan §3.3)", () => {
    expect(defaultStudioHome({ platform: "linux", homeDir: "/home/u", env: {} })).toBe("/home/u/.local/share/zkidz-studio");
    expect(defaultStudioHome({ platform: "darwin", homeDir: "/Users/u", env: {} })).toBe("/Users/u/Library/Application Support/zkidz-studio");
    expect(defaultStudioHome({ platform: "win32", homeDir: "C:\\Users\\u", env: { LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" } })).toBe(
      "C:\\Users\\u\\AppData\\Local\\zkidz-studio",
    );
  });

  it("honours XDG_DATA_HOME on Linux", () => {
    expect(defaultStudioHome({ platform: "linux", homeDir: "/home/u", env: { XDG_DATA_HOME: "/data" } })).toBe("/data/zkidz-studio");
  });
});

describe("loadServerConfig", () => {
  // A developer's own ZKS_FFMPEG must not decide which branch these tests take.
  beforeEach(() => vi.stubEnv("ZKS_FFMPEG", ""));
  afterEach(() => vi.unstubAllEnvs());

  it("defaults the port and leaves DATABASE_URL unset for PGlite", () => {
    const config = loadServerConfig({ ZKS_HOME: "/srv/zks" });
    expect(config).toMatchObject({ studioHome: "/srv/zks", port: APP_PORT, databaseUrl: undefined, isContainer: false });
  });

  const pinnedFfmpeg = loadToolsLock().tools.ffmpeg.platforms[platformKey()];
  it.runIf(pinnedFfmpeg !== undefined && isDownload(pinnedFfmpeg))("resolves ffprobe beside the pinned ffmpeg in ZKS_HOME, never on PATH", async () => {
    if (pinnedFfmpeg === undefined || !isDownload(pinnedFfmpeg)) return;
    scratchDir = await mkdtemp(join(tmpdir(), "zks-tools-"));
    const pinnedDir = join(scratchDir, "tools", "ffmpeg", pinnedFfmpeg.sha256.slice(0, 12), dirname(pinnedFfmpeg.executable ?? "ffmpeg"));
    const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    await mkdir(pinnedDir, { recursive: true });
    await writeFile(join(pinnedDir, ffprobeName), "", { mode: 0o755 });

    const config = loadServerConfig({ ZKS_HOME: scratchDir });

    expect(config.ffprobePath).toBe(join(pinnedDir, ffprobeName));
    await expect(assertFfprobeInstalled(config.ffprobePath)).resolves.toBeUndefined();
  });

  it("reads ZKS_PORT, ZKS_CONTAINER and finds ffprobe beside ZKS_FFMPEG", () => {
    const config = loadServerConfig({ ZKS_HOME: "/srv/zks", ZKS_PORT: "5000", ZKS_CONTAINER: "1", ZKS_FFMPEG: "/opt/ff/bin/ffmpeg" });
    expect(config).toMatchObject({ port: 5000, isContainer: true, ffprobePath: "/opt/ff/bin/ffprobe" });
  });

  it("rejects a port that is not 1..65535", () => {
    expect(() => loadServerConfig({ ZKS_HOME: "/srv/zks", ZKS_PORT: "70000" })).toThrow(/ZKS_PORT/);
    expect(() => loadServerConfig({ ZKS_HOME: "/srv/zks", ZKS_PORT: "abc" })).toThrow(/ZKS_PORT/);
  });

  it("rejects a relative ZKS_HOME", () => {
    expect(() => loadServerConfig({ ZKS_HOME: "relative/home" })).toThrow(/ZKS_HOME/);
  });
});

describe("assertFfprobeInstalled", () => {
  it("refuses to start without the pinned tool and says how to install it", async () => {
    await expect(assertFfprobeInstalled("/no/such/tools/ffmpeg/bin/ffprobe")).rejects.toThrow(/pnpm zks setup/);
  });
});

describe("ensureStudioHome", () => {
  it("creates the home and its layout owner-only", async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-home-"));
    const studioHome = join(scratchDir, "studio");
    await ensureStudioHome(studioHome);
    for (const dir of ["", ...STUDIO_HOME_DIRS]) {
      const dirStat = await stat(join(studioHome, dir));
      expect(dirStat.isDirectory()).toBe(true);
      if (process.platform !== "win32") expect(dirStat.mode & 0o777).toBe(0o700);
    }
  });
});
