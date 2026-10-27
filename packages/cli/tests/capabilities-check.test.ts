// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { STUDIO_TOOLS } from "@zks/shared";
import { findOnPath, loadToolsLock, platformKey } from "@zks/shared/node";
import { afterAll, describe, expect, it } from "vitest";
import { writeCapabilities, ENGINE_DIR } from "../src/capabilities.ts";
import type { ZksContext } from "../src/context.ts";
import type { CommandRunner } from "../src/exec.ts";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const CAPABILITIES = { profile: "nvidia", features: { uhd: true, intro: true, zoomExpr: false, matte: false }, transcribe: "whisper.cpp" };
const ATTEMPTS = [
  { backend: "nvidia", encoder: "hevc_nvenc", ok: true, libplacebo: false },
  { backend: "cpu", encoder: "libx265", ok: true },
];
const tempHomes: string[] = [];

function scratchContext(): ZksContext {
  const home = mkdtempSync(path.join(tmpdir(), "zks-caps-"));
  tempHomes.push(home);
  return { home, toolsDir: path.join(home, "tools"), modelsDir: path.join(home, "models"), platform: platformKey(), lock: loadToolsLock() };
}

function engineRunner(report: unknown, code = 0, calls: { command: string; args: string[]; env?: Record<string, string> }[] = []): CommandRunner {
  return (command, args, _timeoutMs, env) => {
    calls.push({ command, args, ...(env ? { env } : {}) });
    return { code, stdout: JSON.stringify(report), stderr: "" };
  };
}

afterAll(() => {
  for (const home of tempHomes) rmSync(home, { recursive: true, force: true });
});

describe("writeCapabilities", () => {
  it("runs zks-engine capabilities with the pinned ffmpeg and ZKS_HOME, and reports the profile", () => {
    const context = scratchContext();
    const calls: { command: string; args: string[]; env?: Record<string, string> }[] = [];
    const report = { capabilities: CAPABILITIES, path: path.join(context.home, "capabilities.json"), attempts: ATTEMPTS };
    const check = writeCapabilities(context, "/opt/ffmpeg", engineRunner(report, 0, calls), "/bin/uv");
    expect(calls[0]?.command).toBe("/bin/uv");
    expect(calls[0]?.args).toEqual(["run", "--project", ENGINE_DIR, "zks-engine", "capabilities", "--json"]);
    expect(calls[0]?.env).toMatchObject({ ZKS_HOME: context.home, ZKS_FFMPEG: "/opt/ffmpeg" });
    expect(check).toMatchObject({ id: "gpu", status: "ok", detail: "nvidia (hevc_nvenc), capabilities.json written" });
    expect(check.data).toEqual({ attempts: ATTEMPTS, capabilities: CAPABILITIES });
  });

  it("warns when only the CPU passed", () => {
    const capabilities = { ...CAPABILITIES, profile: "cpu" };
    const attempts = [{ backend: "nvidia", encoder: "hevc_nvenc", ok: false }, ATTEMPTS[1]];
    const check = writeCapabilities(scratchContext(), "/opt/ffmpeg", engineRunner({ capabilities, path: "x", attempts }), "/bin/uv");
    expect(check).toMatchObject({ status: "warn", required: false, detail: "cpu (libx265), capabilities.json written" });
  });

  it("fails, required, when no backend passed a test encode", () => {
    const attempts = ATTEMPTS.map((attempt) => ({ ...attempt, ok: false }));
    const check = writeCapabilities(scratchContext(), "/opt/ffmpeg", engineRunner({ capabilities: CAPABILITIES, path: "x", attempts }), "/bin/uv");
    expect(check).toMatchObject({ status: "fail", required: true });
  });

  it("fails with the engine's own message when the engine errors", () => {
    const report = { error: { code: "engine_error", message: "OSError: boom" } };
    const check = writeCapabilities(scratchContext(), "/opt/ffmpeg", engineRunner(report, 1), "/bin/uv");
    expect(check).toMatchObject({ id: "gpu", status: "fail", required: true, detail: "zks-engine capabilities: OSError: boom" });
  });

  it("never creates a ZKS_HOME that setup has not made", () => {
    const context = { ...scratchContext(), home: path.join(tmpdir(), `zks-absent-${process.pid}`) };
    const calls: { command: string; args: string[] }[] = [];
    const check = writeCapabilities(context, "/opt/ffmpeg", engineRunner({}, 0, calls), "/bin/uv");
    expect(calls).toEqual([]);
    expect(check).toMatchObject({ status: "fail", fix: "run: pnpm zks setup" });
    expect(existsSync(context.home)).toBe(false);
  });
});

// The real thing: zks doctor in a scratch ZKS_HOME, against this machine's ffmpeg and the engine's uv project.
const systemFfmpeg = findOnPath("ffmpeg");
const uv = findOnPath("uv");
describe.skipIf(!systemFfmpeg || !uv)("zks doctor", () => {
  it("writes capabilities.json that the get_capabilities schema accepts", { timeout: 900_000 }, () => {
    const { home } = scratchContext();
    const uvCache = spawnSync(uv ?? "uv", ["cache", "dir"], { encoding: "utf8" }).stdout.trim();
    const outcome = spawnSync(process.execPath, [MAIN, "doctor", "--json"], {
      encoding: "utf8",
      // The engine venv and uv cache stay where they are: a scratch UV_CACHE_DIR would re-download every wheel.
      env: { ...process.env, ZKS_HOME: home, ZKS_FFMPEG: systemFfmpeg, UV_CACHE_DIR: uvCache },
    });
    const report = JSON.parse(outcome.stdout) as { checks: { id: string; status: string; detail: string }[] };
    const gpu = report.checks.find((check) => check.id === "gpu");
    expect(gpu?.status, outcome.stdout).not.toBe("fail");
    const written: unknown = JSON.parse(readFileSync(path.join(home, "capabilities.json"), "utf8"));
    expect(STUDIO_TOOLS.get_capabilities.output.parse(written)).toEqual(written);
    expect(gpu?.detail).toContain(STUDIO_TOOLS.get_capabilities.output.parse(written).profile);
  });
});
