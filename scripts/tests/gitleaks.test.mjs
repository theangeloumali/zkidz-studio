// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const repoConfigPath = join(repoRoot, ".gitleaks.toml");
const scanScriptPath = join(repoRoot, ".github/scripts/gitleaks-scan.sh");
const gitleaksInstalled = spawnSync("gitleaks", ["version"]).status === 0;
const LEAKS_FOUND_EXIT = 1;

// Built by concatenation so this file never matches the rule it tests.
const dbUrl = (/** @type {string} */ userinfo) => "postgresql://" + userinfo + "@db.example.org:5432/app";
const fakeDbCredential = "app:" + "Xk9vQ2mLr7TzWp4N";
const allowEverythingConfig = "[allowlist]\npaths = ['''.*''']\n";

/** @param {string} cwd @param {...string} args */
function runGit(cwd, ...args) {
  const result = spawnSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args], {
    cwd,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

/** @param {string} cwd @param {Record<string, string>} files */
function commitFiles(cwd, files) {
  for (const [name, content] of Object.entries(files)) writeFileSync(join(cwd, name), content);
  runGit(cwd, "add", "-A");
  runGit(cwd, "commit", "-qm", "fixture", "--allow-empty");
  return runGit(cwd, "rev-parse", "HEAD");
}

describe.skipIf(!gitleaksInstalled)("database-url-credentials rule", () => {
  let fixtureDir = "";
  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "zks-gitleaks-rule-"));
  });
  afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

  /** @param {Record<string, string>} files @returns {string[]} */
  function flaggedFiles(files) {
    for (const [name, url] of Object.entries(files)) writeFileSync(join(fixtureDir, name), `DATABASE_URL=${url}\n`);
    const reportPath = join(fixtureDir, "report.json");
    spawnSync("gitleaks", ["dir", fixtureDir, "--no-banner", "--config", repoConfigPath, "--report-format", "json", "--report-path", reportPath]);
    /** @type {{ File: string }[]} */
    const findings = JSON.parse(readFileSync(reportPath, "utf8"));
    return findings.map((finding) => basename(finding.File)).sort();
  }

  it("flags real passwords, including ones holding $ and *", () => {
    expect(flaggedFiles({ "plain.env": dbUrl(fakeDbCredential), "special.env": dbUrl("app:Xk9$vQ2mLr*7TzWp4N") })).toEqual(["plain.env", "special.env"]);
  });

  it("passes placeholders and the loopback Supabase default", () => {
    const flagged = flaggedFiles({
      "env-var.env": dbUrl("app:${DB_PASSWORD}"),
      "angle.env": dbUrl("app:<password>"),
      "masked.env": dbUrl("app:****"),
      "loopback.env": "postgresql://postgres:postgres@127.0.0.1:45322/postgres",
    });
    expect(flagged).toEqual([]);
  });
});

describe.skipIf(!gitleaksInstalled)("gitleaks-scan.sh on a pull request", () => {
  let repoDir = "";
  let baseSha = "";
  beforeEach(() => {
    repoDir = mkdtempSync(join(tmpdir(), "zks-gitleaks-scan-"));
    runGit(repoDir, "init", "-q");
    copyFileSync(repoConfigPath, join(repoDir, ".gitleaks.toml"));
    baseSha = commitFiles(repoDir, { "README.md": "base\n" });
  });
  afterEach(() => rmSync(repoDir, { recursive: true, force: true }));

  const scan = (/** @type {string[]} */ ...args) => spawnSync("bash", [scanScriptPath, ...args], { cwd: repoDir, encoding: "utf8" }).status;

  it("passes a clean pull request", () => {
    commitFiles(repoDir, { "notes.md": "nothing secret\n" });
    expect(scan(baseSha)).toBe(0);
  });

  it("judges the PR by the base config, not one the PR loosened", () => {
    commitFiles(repoDir, { ".gitleaks.toml": allowEverythingConfig, "app.env": dbUrl(fakeDbCredential) });
    expect(scan()).toBe(0);
    expect(scan(baseSha)).toBe(LEAKS_FOUND_EXIT);
  });

  it("ignores a .gitleaksignore the PR added", () => {
    const leakSha = commitFiles(repoDir, { "app.env": dbUrl(fakeDbCredential) });
    commitFiles(repoDir, { ".gitleaksignore": `${leakSha}:app.env:database-url-credentials:1\n` });
    expect(scan(baseSha)).toBe(LEAKS_FOUND_EXIT);
  });

  it("ignores gitleaks:allow markers", () => {
    commitFiles(repoDir, { "app.env": `${dbUrl(fakeDbCredential)} # gitleaks:allow\n` });
    expect(scan(baseSha)).toBe(LEAKS_FOUND_EXIT);
  });

  it("falls back to the default rules when the base has no config", () => {
    runGit(repoDir, "rm", "-q", ".gitleaks.toml");
    const bareBaseSha = commitFiles(repoDir, {});
    commitFiles(repoDir, { ".gitleaks.toml": allowEverythingConfig, "token.txt": "ghp_" + "R7tK2mQ9xWv4Lp8Zc3Nb6Hj1Ds5Fg0Ya2Ue7\n" });
    expect(scan(bareBaseSha)).toBe(LEAKS_FOUND_EXIT);
  });
});
