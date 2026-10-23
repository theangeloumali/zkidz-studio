// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
// Each spawn loads the CLI cold; on a slow filesystem (WSL /mnt) that alone takes ~4 s.
const SUBPROCESS_TIMEOUT_MS = 30_000;
const tempHomes: string[] = [];

function runCli(args: string[], home = mkdtempSync(path.join(tmpdir(), "zks-cli-"))) {
  tempHomes.push(home);
  return spawnSync(process.execPath, [MAIN, ...args], { encoding: "utf8", env: { ...process.env, ZKS_HOME: home } });
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
  });

  it("rejects an unknown command with usage and exit 2", () => {
    const outcome = runCli(["deploy"]);
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: zks (setup|doctor|models)/);
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
    const outcome = runCli(["doctor", "--json"], missingHome);
    expect(outcome.status).toBe(1);
    const report = JSON.parse(outcome.stdout) as { ok: boolean; checks: { id: string }[] };
    expect(report.ok).toBe(false);
    expect(report.checks.map((check) => check.id)).toContain("disk");
    expect(outcome.stdout + outcome.stderr).not.toContain(homedir());
    expect(existsSync(missingHome)).toBe(false);
  });
});
