// Created by The Angelo Umali.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LANES = fileURLToPath(new URL("../lib/ci-lanes.sh", import.meta.url));

// Runs the scheduler with stand-in steps: each sleeps briefly, and "bad" fails.
/** @param {number} lanes @param {string[]} steps */
function schedule(lanes, steps) {
  const script = `
    set -uo pipefail
    source "$1"
    for name in ${steps.join(" ")}; do eval "step_$name() { sleep 0.2; [[ $name != bad ]]; }"; done
    report() { echo "$1 $2"; }
    run_lanes ${lanes} "$(mktemp -d)" ${steps.join(" ")}
  `;
  return spawnSync("bash", ["-c", script, "ci-lanes", LANES], { encoding: "utf8" });
}

// An empty associative array is unbound under set -u, which once skipped every parallel step and still passed.
// lib/ci-lanes.sh uses `local -A` and `wait -n` (bash 4.3+); macOS ships bash 3.2.
const bashVersion = spawnSync("bash", ["-c", 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], { encoding: "utf8" }).stdout.trim();
const [bashMajor = 0, bashMinor = 0] = bashVersion.split(".").map(Number);
const bashHasLanes = bashMajor > 4 || (bashMajor === 4 && bashMinor >= 3);

describe.skipIf(!bashHasLanes)("ci-local lanes", () => {
  it.each([1, 2, 6])("runs and reports every step with %i lanes", (lanes) => {
    const outcome = schedule(lanes, ["one", "two", "three", "bad"]);
    expect(outcome.stderr).toBe("");
    const reported = outcome.stdout.trim().split("\n").sort();
    expect(reported).toEqual(["bad 1", "one 0", "three 0", "two 0"]);
  });
});
