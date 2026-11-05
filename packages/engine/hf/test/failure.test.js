// Created by The Angelo Umali.
// How a HyperFrames child is run and how its failure reads: the engine reports a failed step by its last line.
const test = require("node:test");
const assert = require("node:assert/strict");
const { childEnv, failureText } = require("../render");

test("the last line of a failure names its reason and how the child ended", () => {
  const text = failureText({ stderr: Buffer.from("Capturing frame 3/4\nError: Target closed\n"), stdout: "", message: "", status: 1 });
  assert.equal(text.trim().split("\n").at(-1), "Error: Target closed (exit code 1)");
});

test("a killed child says so after its last output", () => {
  const text = failureText({ stderr: "", stdout: "rendering", message: "", signal: "SIGKILL" });
  assert.equal(text.split("\n").at(-1), "rendering (killed by SIGKILL)");
});

test("every HyperFrames child waits a minute for its page, not 10 s", () => {
  // A loaded machine (load 33) failed caption snapshots on "Navigation timeout of 10000 ms exceeded"; --timeout is only
  // the settle wait, the page load is PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS.
  assert.ok(Number(childEnv().PRODUCER_PAGE_NAVIGATION_TIMEOUT_MS) >= 60000);
});
