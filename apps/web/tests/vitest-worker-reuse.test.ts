// Created by The Angelo Umali.
// @vitest-environment node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "broken-start");
const VITEST_BIN = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");

function runBrokenStartFixture() {
  // The parent run's VITEST_* variables would make the child think it is a worker.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITEST")));
  const result = spawnSync(process.execPath, [VITEST_BIN, "run", "--root", FIXTURE_DIR, "--config", "vitest.fixture.config.mjs"], {
    encoding: "utf8",
    env: { ...env, NO_COLOR: "1" },
    // Inside the test's 180 s, so a hung child fails this test instead of outliving it.
    timeout: 170_000,
    killSignal: "SIGKILL",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe("vitest worker that fails to start", () => {
  // Under ci:local load the jsdom start ran out of time; vitest reused that dead fork and crashed on its own SIGTERM.
  it("reports every file it could not start instead of crashing on the failed worker's exit", { timeout: 180_000 }, () => {
    const { status, output } = runBrokenStartFixture();

    expect(output).not.toContain("Worker exited unexpectedly");
    expect(output.match(/Failed to start forks worker/g)).toHaveLength(4);
    expect(status).toBe(1);
  });
});
