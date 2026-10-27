// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
// Each spawn loads the CLI cold: @zks/shared's sources alone take 3.5 s over WSL /mnt, and 20-27 s per spawn under
// ci:local load. Two-spawn tests need room for both.
const SUBPROCESS_TIMEOUT_MS = 90_000;
const tempHomes: string[] = [];

function runCli(args: string[], home = mkdtempSync(path.join(tmpdir(), "zks-cli-")), env: Record<string, string | undefined> = {}) {
  tempHomes.push(home);
  return spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", env: { ...process.env, ZKS_HOME: home, ...env } });
}

describe("zks CLI", { timeout: SUBPROCESS_TIMEOUT_MS }, () => {
  afterAll(() => {
    for (const home of tempHomes) rmSync(home, { recursive: true, force: true });
  });

  it("lists pinned models as JSON without downloading", () => {
    const listing = runCli(["models", "--json"]);
    expect(listing.status).toBe(0);
    const models = JSON.parse(listing.stdout) as { name: string; installed: boolean }[];
    expect(models.find((model) => model.name === "base")).toMatchObject({ installed: false, fetchOnSetup: true });
    // Plan §7.4: the pinned whisper-cli is a CPU build, and on CPU the quantised turbo is the model edits and QC use.
    expect(models.find((model) => model.name === "large-v3-turbo-q5_0")).toMatchObject({ installed: false, fetchOnSetup: true });
  });

  it("rejects an unknown command with usage and exit 2", () => {
    const outcome = runCli(["deploy"]);
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: zks (setup|doctor|models)/);
  });

  it("prints usage with every doctor flag on --help, exit 0", () => {
    const outcome = runCli(["--help"]);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("zks doctor [--json] [--fetch] [--render] [--bench]");
  });

  // CI and the server hand the engine these paths (ZKS_FFMPEG, ZKS_CHROME), so the renders use the pinned builds.
  it("prints the pinned Chrome path once it is installed, and fails with the setup hint before", () => {
    const home = mkdtempSync(path.join(tmpdir(), "zks-cli-"));
    const missing = runCli(["tools", "path", "chrome-headless-shell"], home);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/pnpm zks setup/);

    const expected = missing.stderr.match(/not installed at (.+)\. Run/)?.[1] ?? "";
    expect(expected.startsWith(path.join(home, "tools", "chrome-headless-shell"))).toBe(true);
    mkdirSync(path.dirname(expected), { recursive: true });
    writeFileSync(expected, "");
    const found = runCli(["tools", "path", "chrome-headless-shell"], home);
    expect(found.status, found.stderr).toBe(0);
    expect(found.stdout.trim()).toBe(expected);
  });

  // CI and the render recipe export ZKS_FFMPEG from this command, so echoing an exported value back would keep a stale one.
  it("prints the pinned ffmpeg even when ZKS_FFMPEG points somewhere else", () => {
    const home = mkdtempSync(path.join(tmpdir(), "zks-cli-"));
    const missing = runCli(["tools", "path", "ffmpeg"], home, { ZKS_FFMPEG: undefined });
    const pinned = missing.stderr.match(/not installed at (.+)\. Run/)?.[1] ?? "";
    expect(pinned.startsWith(path.join(home, "tools", "ffmpeg"))).toBe(true);
    mkdirSync(path.dirname(pinned), { recursive: true });
    writeFileSync(pinned, "");

    const found = runCli(["tools", "path", "ffmpeg"], home, { ZKS_FFMPEG: "/usr/bin/ffmpeg" });
    expect(found.status, found.stderr).toBe(0);
    expect(found.stdout.trim()).toBe(pinned);
  });

  it("rejects an unknown tool name with usage and exit 2", () => {
    const outcome = runCli(["tools", "path", "blender"]);
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/zks tools path/);
  });

  it("rejects an unknown model name", () => {
    const outcome = runCli(["models", "fetch", "huge"]);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('Unknown model "huge"');
  });

  // A fresh install has no ZKS_HOME yet; doctor must still diagnose it, as JSON, without naming the user.
  it("reports a missing ZKS_HOME as failed checks in valid, redacted JSON", { timeout: 120_000 }, () => {
    const missingHome = path.join(homedir(), `.zks-missing-${process.pid}`);
    const outcome = runCli(["doctor", "--json"], missingHome, { DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:45322/postgres" });
    expect(outcome.status).toBe(1);
    const report = JSON.parse(outcome.stdout) as { ok: boolean; checks: { id: string; status: string }[] };
    expect(report.ok).toBe(false);
    expect(report.checks.map((check) => check.id)).toContain("disk");
    expect(report.checks.find((check) => check.id === "database")).toMatchObject({ status: "fail" });
    expect(outcome.stdout + outcome.stderr).not.toContain(homedir());
    expect(existsSync(missingHome)).toBe(false);
  });
});
