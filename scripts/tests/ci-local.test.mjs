// Created by The Angelo Umali.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../ci-local.sh", import.meta.url));
const listSteps = (/** @type {string[]} */ args) => spawnSync("bash", [SCRIPT, "--list", ...args], { encoding: "utf8" });

// The local run stands in for every Linux job the GitHub workflows ran, so a merge is checked the same way.
describe("ci-local", () => {
  // The lint, scan and install run first; then every check that shares nothing runs side by side. The server suite keeps
  // its own lane: each of its files boots a PGlite, and beside the other suites that once ran out of memory.
  it("runs the setup steps in turn, then the independent checks side by side", () => {
    const listing = listSteps([]);
    expect(listing.status, listing.stderr).toBe(0);
    expect(listing.stdout.trim().split("\n")).toEqual(["actionlint", "gitleaks", "install", "parallel: engine lint test-server typecheck test-other format"]);
  });

  it("adds the fresh-machine setup and the doctor for a release merge", () => {
    expect(listSteps(["--release"]).stdout.trim().split("\n").slice(-1)).toEqual(["setup-doctor"]);
  });

  it("splits the engine suite over ZKS_CI_JOBS workers, six by default", () => {
    expect(spawnSync("bash", [SCRIPT, "--list-jobs"], { encoding: "utf8" }).stdout.trim()).toBe("6");
    expect(spawnSync("bash", [SCRIPT, "--list-jobs"], { encoding: "utf8", env: { ...process.env, ZKS_CI_JOBS: "3" } }).stdout.trim()).toBe("3");
  });

  // Starting every lane on an already busy machine starved vitest of workers ("Failed to start forks worker").
  it("runs every lane at once on an idle machine and fewer when the load already exceeds the cores", () => {
    const lanes = (/** @type {Record<string, string>} */ env) =>
      spawnSync("bash", [SCRIPT, "--list-lanes"], { encoding: "utf8", env: { ...process.env, ...env } }).stdout.trim();
    expect(lanes({ ZKS_CI_LOAD: "2", ZKS_CI_CORES: "24" })).toBe("6");
    expect(lanes({ ZKS_CI_LOAD: "40", ZKS_CI_CORES: "24" })).toBe("2");
    expect(lanes({ ZKS_CI_LOAD: "40", ZKS_CI_CORES: "24", ZKS_CI_LANES: "4" })).toBe("4");
  });

  // A zero or non-numeric count would leave the lane loop waiting forever on a run that never starts.
  it("refuses a lane or job count that is not a positive whole number", () => {
    /** @type {[string, string][]} */
    const cases = [
      ["ZKS_CI_LANES", "0"],
      ["ZKS_CI_LANES", "two"],
      ["ZKS_CI_JOBS", "0"],
      ["ZKS_CI_JOBS", "-3"],
    ];
    for (const [name, value] of cases) {
      const outcome = spawnSync("bash", [SCRIPT, "--list-lanes"], { encoding: "utf8", env: { ...process.env, [name]: value } });
      expect(outcome.status, `${name}=${value}`).toBe(2);
      expect(outcome.stderr).toContain(name);
    }
  });

  /**
   * Sources the script with a fake pnpm on PATH, runs the steps each in its own subshell as the real run does, and
   * returns pnpm's calls as "<VITEST_MAX_WORKERS> <ZKS_FFMPEG> <ZKS_CHROME> <args>".
   * @param {string[]} steps @param {Record<string, string>} envOverrides
   */
  function pnpmCallsOf(steps, envOverrides = {}) {
    const fakeBinDir = mkdtempSync(join(tmpdir(), "zks-ci-local-"));
    const callLog = join(fakeBinDir, "calls.log");
    const fakePnpm = [
      "#!/usr/bin/env bash",
      'if [[ "$1 $2 $3 $4" == "-s zks tools path" ]]; then echo "/pinned/$5"; exit 0; fi',
      `echo "\${VITEST_MAX_WORKERS:-unset} \${ZKS_FFMPEG:-none} \${ZKS_CHROME:-none} $*" >>"${callLog}"`,
    ].join("\n");
    try {
      writeFileSync(join(fakeBinDir, "pnpm"), `${fakePnpm}\n`, { mode: 0o755 });
      // Cleared because ci:local's own lane exports them to this test.
      const env = { ...process.env, VITEST_MAX_WORKERS: "", ZKS_FFMPEG: "", ZKS_CHROME: "", ...envOverrides, PATH: `${fakeBinDir}:${process.env["PATH"]}` };
      const runSteps = steps.map((step) => `(step_${step})`).join(" && ");
      const outcome = spawnSync("bash", ["-c", `script=$1 && set -- && source "$script" && ${runSteps}`, "_", SCRIPT], { encoding: "utf8", env });
      expect(outcome.status, outcome.stderr).toBe(0);
      return readFileSync(callLog, "utf8").trim().split("\n");
    } finally {
      rmSync(fakeBinDir, { recursive: true, force: true });
    }
  }

  // Unbounded, vitest forks one worker per core in each lane beside the engine pool, and load-flaky timeouts followed.
  it.each([
    ["the default", {}, "6"],
    ["ZKS_CI_JOBS", { ZKS_CI_JOBS: "3" }, "3"],
  ])("caps each test lane at ZKS_CI_JOBS workers, one package at a time (%s)", (_label, envOverrides, workers) => {
    expect(pnpmCallsOf(["test-server", "test-other"], envOverrides).map((call) => call.replace(/^(\S+) \S+ \S+ /, "$1 "))).toEqual([
      `${workers} -F @zks/server test`,
      `${workers} -r --workspace-concurrency=1 --filter !@zks/server test`,
    ]);
  });

  // The server's real demo render (demo-runner.test.ts) skips without them, so the gate would never render the demo.
  it("installs the pinned tools before the lanes and hands them to the server suite", () => {
    expect(pnpmCallsOf(["install", "test-server"])).toEqual([
      "unset none none install --frozen-lockfile",
      "unset none none -s zks setup",
      "6 /pinned/ffmpeg /pinned/chrome-headless-shell -F @zks/server test",
    ]);
  });

  // Sourced, $0 is the caller's shell, so a root taken from it pointed pnpm at whatever workspace enclosed the caller.
  it("resolves the repo root from the script itself when sourced from elsewhere", () => {
    const outcome = spawnSync("bash", ["-c", 'script=$1 && set -- && source "$script" && echo "$REPO_ROOT"', "_", SCRIPT], { encoding: "utf8", cwd: tmpdir() });
    expect(outcome.stdout.trim()).toBe(fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, ""));
  });

  // Overlapping runs from parallel sessions pushed vitest past its 60 s worker-start timeout, so runs take turns.
  it("waits for another ci-local run on this machine to finish before starting", () => {
    const lockFile = join(mkdtempSync(join(tmpdir(), "zks-ci-lock-")), "ci-local.lock");
    const holder = spawnSync("bash", ["-c", `exec 9>"${lockFile}"; flock 9; timeout 3 bash "${SCRIPT}" 2>&1; echo "status=$?"`], {
      encoding: "utf8",
      env: { ...process.env, ZKS_CI_LOCK: lockFile },
    });
    expect(holder.stdout).toContain("waiting for another ci-local run");
    expect(holder.stdout).toContain("status=124");
  });

  // Worktrees running it at once timed out starting vitest workers, so a run waits for the machine-wide lock.
  it("gives up when another run holds the lock past ZKS_CI_LOCK_WAIT_S", () => {
    const lockFile = join(mkdtempSync(join(tmpdir(), "zks-ci-lock-")), "ci-local.lock");
    const holder = spawn("flock", [lockFile, "sleep", "5"], { stdio: "ignore" });
    let lockIsFree = true;
    while (lockIsFree) lockIsFree = spawnSync("flock", ["-n", lockFile, "true"]).status === 0; // wait for the holder

    const outcome = spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, ZKS_CI_LOCK: lockFile, ZKS_CI_LOCK_WAIT_S: "1" } });
    holder.kill();

    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toMatch(/another ci-local run holds/);
    expect(outcome.stdout).not.toMatch(/PASS|FAIL/);
  });

  // One cap for every test lane: ZKS_CI_JOBS workers, six by default.
  it("caps vitest workers and runs the other packages' suites one at a time", () => {
    const listing = spawnSync("bash", [SCRIPT, "--list-test-env"], { encoding: "utf8" });
    expect(listing.stdout.trim()).toBe("VITEST_MAX_WORKERS=6 workspace-concurrency=1");
  });

  it("rejects an unknown option", () => {
    const outcome = spawnSync("bash", [SCRIPT, "--fast-please"], { encoding: "utf8" });
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: .*ci-local/);
  });
});
