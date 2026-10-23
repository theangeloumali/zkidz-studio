// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadToolsLock, pinnedExecutablePath, platformKey } from "@zks/shared/node";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../pinned-ffmpeg.mjs", import.meta.url));
/** @type {string[]} */
const scratchDirs = [];

/** @param {Record<string, string>} env */
function runScript(env) {
  const { ZKS_FFMPEG: _ignored, ...inherited } = process.env;
  return spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...inherited, ...env } });
}

afterEach(() => {
  for (const directory of scratchDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

// CI points the engine at this path, so its tests render with the build users get instead of the runner's apt ffmpeg.
describe("pinned-ffmpeg", () => {
  it("prints the pinned ffmpeg installed under ZKS_HOME/tools", () => {
    const studioHome = mkdtempSync(join(tmpdir(), "zks-pinned-"));
    scratchDirs.push(studioHome);
    const ffmpeg = pinnedExecutablePath({ toolsDir: join(studioHome, "tools"), platform: platformKey(), lock: loadToolsLock() }, "ffmpeg");
    if (!ffmpeg) throw new Error("this platform pins no ffmpeg download");
    mkdirSync(dirname(ffmpeg), { recursive: true });
    writeFileSync(ffmpeg, "");

    const run = runScript({ ZKS_HOME: studioHome });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(ffmpeg);
  });

  it("fails with the setup hint when the pinned ffmpeg is not installed", () => {
    const studioHome = mkdtempSync(join(tmpdir(), "zks-pinned-"));
    scratchDirs.push(studioHome);

    const run = runScript({ ZKS_HOME: studioHome });

    expect(run.status).toBe(1);
    expect(run.stdout).toBe("");
    expect(run.stderr).toMatch(/pnpm zks setup/);
  });
});
