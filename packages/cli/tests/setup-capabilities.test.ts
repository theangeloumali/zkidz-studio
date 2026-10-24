// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_TOOLS } from "@zks/shared";
import { findOnPath, loadToolsLock, platformKey } from "@zks/shared/node";
import { afterAll, describe, expect, it } from "vitest";
import type { ZksContext } from "../src/context.ts";
import type { CommandRunner } from "../src/exec.ts";
import { recordCapabilities } from "../src/setup.ts";
import { toolExecutablePath } from "../src/tools.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CAPABILITIES = { profile: "nvidia", features: { uhd: true, intro: true, zoomExpr: false, matte: false }, transcribe: "whisper.cpp" };
const tempHomes: string[] = [];

function scratchContext(): ZksContext {
  const home = mkdtempSync(path.join(tmpdir(), "zks-setup-"));
  tempHomes.push(home);
  return { home, toolsDir: path.join(home, "tools"), modelsDir: path.join(home, "models"), platform: platformKey(), lock: loadToolsLock() };
}

afterAll(() => {
  for (const home of tempHomes) rmSync(home, { recursive: true, force: true });
});

describe("recordCapabilities", () => {
  it("probes with the ffmpeg setup installed (or the ZKS_FFMPEG override, as doctor) and logs the profile", () => {
    const context = scratchContext();
    const ffmpegPaths: (string | undefined)[] = [];
    const lines: string[] = [];
    const run: CommandRunner = (_command, _args, _timeoutMs, env) => {
      ffmpegPaths.push(env?.ZKS_FFMPEG);
      const attempts = [{ backend: "nvidia", encoder: "hevc_nvenc", ok: true }];
      return { code: 0, stdout: JSON.stringify({ capabilities: CAPABILITIES, path: "x", attempts }), stderr: "" };
    };
    recordCapabilities(context, (line) => lines.push(line), run, "/bin/uv");
    expect(ffmpegPaths).toEqual([toolExecutablePath(context, "ffmpeg")]);
    expect(lines).toEqual(["capabilities           nvidia (hevc_nvenc), capabilities.json written"]);
  });

  it("fails setup when the probe cannot write the file", () => {
    const run: CommandRunner = () => ({ code: 1, stdout: JSON.stringify({ error: { message: "OSError: boom" } }), stderr: "" });
    expect(() => recordCapabilities(scratchContext(), () => undefined, run, "/bin/uv")).toThrow("zks-engine capabilities: OSError: boom");
  });
});

// Downloads the pinned ffmpeg, Chrome and models (hundreds of MB), so it runs only when asked: ZKS_SETUP_E2E=1.
const uv = findOnPath("uv");
describe.skipIf(!process.env.ZKS_SETUP_E2E || !uv)("zks setup", () => {
  it("leaves a capabilities.json the get_capabilities schema accepts", { timeout: 1_800_000 }, () => {
    const { home } = scratchContext();
    const uvCache = spawnSync(uv ?? "uv", ["cache", "dir"], { encoding: "utf8" }).stdout.trim();
    const env = { ...process.env, ZKS_HOME: home, ZKS_FFMPEG: undefined, UV_CACHE_DIR: uvCache };
    const outcome = spawnSync(process.execPath, [MAIN, "setup"], { encoding: "utf8", env });
    expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
    const written: unknown = JSON.parse(readFileSync(path.join(home, "capabilities.json"), "utf8"));
    expect(STUDIO_TOOLS.get_capabilities.output.parse(written)).toEqual(written);
  });
});
