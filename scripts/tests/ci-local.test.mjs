// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../ci-local.sh", import.meta.url));
const listSteps = (/** @type {string[]} */ args) => spawnSync("bash", [SCRIPT, "--list", ...args], { encoding: "utf8" });

// The local run stands in for every Linux job the GitHub workflows ran, so a merge is checked the same way.
describe("ci-local", () => {
  it("runs the workflow lint, leak scan, verify and the engine suite before every merge", () => {
    const listing = listSteps([]);
    expect(listing.status, listing.stderr).toBe(0);
    expect(listing.stdout.trim().split("\n")).toEqual(["actionlint", "gitleaks", "install", "format", "verify", "engine"]);
  });

  it("adds the fresh-machine setup and the doctor for a release merge", () => {
    expect(listSteps(["--release"]).stdout.trim().split("\n").slice(-1)).toEqual(["setup-doctor"]);
  });

  it("rejects an unknown option", () => {
    const outcome = spawnSync("bash", [SCRIPT, "--fast-please"], { encoding: "utf8" });
    expect(outcome.status).toBe(2);
    expect(outcome.stderr).toMatch(/usage: .*ci-local/);
  });
});
