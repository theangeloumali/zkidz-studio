// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const OWNED_WORKFLOWS = ["release.yml", "tools-lock.yml", "setup-e2e.yml"];
const CHECK_STEP_NAME = "Re-check every pinned SHA-256";
const APP_CHECK_STEP_NAME = "Check the release GitHub App is configured";
const jqAndCurlInstalled = spawnSync("jq", ["--version"]).status === 0 && spawnSync("curl", ["--version"]).status === 0;

const readWorkflow = (/** @type {string} */ name) => readFileSync(join(REPO_ROOT, ".github/workflows", name), "utf8");
const readJson = (/** @type {string} */ name) => JSON.parse(readFileSync(join(REPO_ROOT, name), "utf8"));

/** The `run: |` body under the step with this name, de-indented (workflows hold no YAML parser dependency). */
function stepScript(/** @type {string} */ workflow, /** @type {string} */ stepName) {
  const lines = workflow.split("\n");
  const nameIndex = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  const runIndex = lines.findIndex((line, index) => index > nameIndex && line.trim() === "run: |");
  if (nameIndex < 0 || runIndex < 0) throw new Error(`step "${stepName}" has no run block`);
  const bodyIndent = (lines[runIndex + 1] ?? "").search(/\S/);
  const body = [];
  for (const line of lines.slice(runIndex + 1)) {
    if (line.trim() !== "" && line.search(/\S/) < bodyIndent) break;
    body.push(line.slice(bodyIndent));
  }
  return body.join("\n");
}

describe("owned workflows", () => {
  it.each(OWNED_WORKFLOWS)("%s pins every action by commit SHA with a tag comment", (name) => {
    const usesLines = readWorkflow(name)
      .split("\n")
      .filter((line) => /^\s*(-\s+)?uses:/.test(line));
    expect(usesLines.length).toBeGreaterThan(0);
    for (const line of usesLines) expect(line).toMatch(/uses:\s+[\w.-]+\/[\w./-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/);
  });

  it.each(OWNED_WORKFLOWS)("%s defaults the token to read-only", (name) => {
    expect(readWorkflow(name)).toMatch(/^permissions:\n {2}contents: read$/m);
  });
});

describe("release-please", () => {
  it("proposes v1.0.0 for the root node package", () => {
    const config = readJson("release-please-config.json");
    expect(config.packages["."]).toMatchObject({ "release-type": "node", "release-as": "1.0.0" });
    expect(config["include-component-in-tag"]).toBe(false);
    expect(readJson(".release-please-manifest.json")).toEqual({ ".": "0.0.0" });
  });

  it("opens release PRs on develop and only tags from main, never targeting main itself", () => {
    const workflow = readWorkflow("release.yml");
    const targets = [...workflow.matchAll(/target-branch:\s*(\S+)/g)].map((match) => match[1]);
    expect(targets.length).toBe(2);
    expect(new Set(targets)).toEqual(new Set(["develop"]));
    expect(workflow).toMatch(/skip-github-release: true/);
    expect(workflow).toMatch(/skip-github-pull-request: true/);
    expect(workflow).not.toMatch(/git push/);
  });

  // A GITHUB_TOKEN-created PR starts no workflow runs, so the release PR would never get CI.
  it("runs every release-please step with a GitHub App token and grants the job token no writes", () => {
    const workflow = readWorkflow("release.yml");
    const releaseSteps = workflow.split(/\n(?=\s*- )/).filter((step) => step.includes("googleapis/release-please-action@"));
    expect(releaseSteps.length).toBe(2);
    for (const step of releaseSteps) expect(step).toMatch(/^\s+token: \$\{\{ steps\.app-token\.outputs\.token \}\}$/m);
    expect(workflow.match(/actions\/create-github-app-token@/g)?.length).toBe(2);
    expect(workflow).not.toMatch(/^\s+(contents|issues|pull-requests): write$/m);
  });

  /** Runs release.yml's App-config check with the repo variable and secret presence it would see. */
  function runAppConfigCheck(/** @type {{ clientId: string, hasKey: string }} */ { clientId, hasKey }) {
    const outputDir = mkdtempSync(join(tmpdir(), "zks-release-app-"));
    const outputPath = join(outputDir, "output");
    writeFileSync(outputPath, "");
    try {
      const result = spawnSync("bash", ["-c", stepScript(readWorkflow("release.yml"), APP_CHECK_STEP_NAME)], {
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: outputPath, RELEASE_APP_CLIENT_ID: clientId, RELEASE_APP_KEY_SET: hasKey },
      });
      return { ...result, outputs: readFileSync(outputPath, "utf8") };
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }

  // Until the App exists the job must pass with a visible warning, never fall back to GITHUB_TOKEN.
  it("skips release-please with a warning while the GitHub App is not configured", () => {
    for (const unset of [
      { clientId: "", hasKey: "false" },
      { clientId: "Iv23example", hasKey: "false" },
      { clientId: "", hasKey: "true" },
    ]) {
      const result = runAppConfigCheck(unset);
      expect(result.status).toBe(0);
      expect(result.outputs).toBe("configured=false\n");
      expect(result.stdout).toMatch(/::warning::.*RELEASE_APP_CLIENT_ID.*RELEASE_APP_PRIVATE_KEY/);
    }
    const configured = runAppConfigCheck({ clientId: "Iv23example", hasKey: "true" });
    expect(configured.status).toBe(0);
    expect(configured.outputs).toBe("configured=true\n");
  });

  it("gates every token and release-please step on the App-config check", () => {
    const steps = readWorkflow("release.yml").split(/\n(?=\s*- )/);
    const gatedSteps = steps.filter((step) => /actions\/create-github-app-token@|googleapis\/release-please-action@/.test(step));
    expect(gatedSteps.length).toBe(4);
    for (const step of gatedSteps) expect(step).toMatch(/^\s+(- )?if: steps\.app-config\.outputs\.configured == 'true'$/m);
  });
});

describe("setup-e2e", () => {
  it("runs the single setup command on the three runner images", () => {
    const workflow = readWorkflow("setup-e2e.yml");
    for (const runner of ["ubuntu-24.04", "macos-15", "windows-2025"]) expect(workflow).toContain(runner);
    expect(workflow).toContain("./setup.sh");
    expect(workflow).toContain("setup.cmd");
    expect(workflow).toContain("127.0.0.1:4317");
  });
});

describe.skipIf(!jqAndCurlInstalled)("tools-lock re-check script", () => {
  let fixtureDir = "";
  beforeEach(() => {
    fixtureDir = mkdtempSync(join(tmpdir(), "zks-tools-lock-"));
  });
  afterEach(() => rmSync(fixtureDir, { recursive: true, force: true }));

  /** Writes a one-tool, one-model lock whose URLs point at local files, then runs the workflow's own step. */
  function runCheck(/** @type {{ toolSha?: string }} */ { toolSha } = {}) {
    const toolPath = join(fixtureDir, "tool.tar.gz");
    const modelPath = join(fixtureDir, "model.bin");
    writeFileSync(toolPath, "tool bytes");
    writeFileSync(modelPath, "model bytes");
    const sha256 = (/** @type {string} */ path) => createHash("sha256").update(readFileSync(path)).digest("hex");
    const lock = {
      schemaVersion: 1,
      tools: {
        demo: { platforms: { "linux-x64": { url: pathToFileURL(toolPath).href, sha256: toolSha ?? sha256(toolPath) }, "mac-arm64": { homebrew: "demo" } } },
      },
      models: { tiny: { url: pathToFileURL(modelPath).href, sha256: sha256(modelPath) } },
    };
    const lockPath = join(fixtureDir, "tools.lock.json");
    writeFileSync(lockPath, JSON.stringify(lock));
    const script = stepScript(readWorkflow("tools-lock.yml"), CHECK_STEP_NAME);
    return spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, LOCK_FILE: lockPath, RUNNER_TEMP: fixtureDir, TOOLS_LOCK_PROTOCOLS: "=file" },
    });
  }

  it("passes when every download matches its pin and skips Homebrew-only entries", () => {
    const result = runCheck();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/2 pinned download\(s\) match/);
  });

  it("fails and names the entry when upstream bytes changed", () => {
    const result = runCheck({ toolSha: "0".repeat(64) });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/MISMATCH tools\.demo\.linux-x64/);
  });
});

// GitHub refuses to start an invalid workflow without failing any check (golden.yml shipped that way), so ci lints them.
describe.skipIf(!jqAndCurlInstalled)("ci workflow lint", () => {
  const LINT_STEP_NAME = "Lint every workflow";
  /** @type {string} */
  let scratchDir = "";
  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "zks-actionlint-"));
    spawnSync("git", ["init", "-q", scratchDir]);
  });
  afterEach(() => rmSync(scratchDir, { recursive: true, force: true }));

  const runLint = (/** @type {string} */ script) =>
    spawnSync("bash", ["-e", "-c", script], { cwd: scratchDir, encoding: "utf8", env: { ...process.env, RUNNER_TEMP: scratchDir } });

  const writeWorkflow = (/** @type {string} */ body) => {
    spawnSync("mkdir", ["-p", join(scratchDir, ".github/workflows")]);
    writeFileSync(join(scratchDir, ".github/workflows/bad.yml"), body);
  };

  it("fails a job-level env that reads the runner context", () => {
    writeWorkflow("on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    env:\n      HOME_DIR: ${{ runner.temp }}/x\n    steps:\n      - run: echo hi\n");
    const result = runLint(stepScript(readWorkflow("ci.yml"), LINT_STEP_NAME));
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('context "runner" is not allowed here');
  }, 60_000);

  it("refuses to run a download whose SHA-256 is not the pinned one", () => {
    writeWorkflow("on: push\njobs:\n  a:\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo hi\n");
    const tampered = stepScript(readWorkflow("ci.yml"), LINT_STEP_NAME).replace(/sha256=[0-9a-f]{64}/, `sha256=${"0".repeat(64)}`);
    const result = runLint(tampered);
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/FAILED/);
  }, 60_000);
});
