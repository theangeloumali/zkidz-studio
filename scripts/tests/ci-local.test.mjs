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
    expect(listing.stdout.trim().split("\n")).toEqual(["actionlint", "gitleaks", "install", "parallel: format lint typecheck test-server test-other engine"]);
  });

  it("adds the fresh-machine setup and the doctor for a release merge", () => {
    expect(listSteps(["--release"]).stdout.trim().split("\n").slice(-1)).toEqual(["setup-doctor"]);
  });

  it("splits the engine suite over ZKS_CI_JOBS workers, six by default", () => {
    expect(spawnSync("bash", [SCRIPT, "--list-jobs"], { encoding: "utf8" }).stdout.trim()).toBe("6");
    expect(spawnSync("bash", [SCRIPT, "--list-jobs"], { encoding: "utf8", env: { ...process.env, ZKS_CI_JOBS: "3" } }).stdout.trim()).toBe("3");
  });

  it("rejects an unknown option", () => {
    const outcome = spawnSync("bash", [SCRIPT, "--fast-please"], { encoding: "utf8" });
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: .*ci-local/);
  });
});
