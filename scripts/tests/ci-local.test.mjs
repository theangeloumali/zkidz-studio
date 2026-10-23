// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
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

  it("rejects an unknown option", () => {
    const outcome = spawnSync("bash", [SCRIPT, "--fast-please"], { encoding: "utf8" });
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: .*ci-local/);
  });
});
