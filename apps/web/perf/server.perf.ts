// Created by The Angelo Umali.
// The server budgets come from `zks doctor --bench`, which boots the shipped bundle twice on a scratch home; this only checks them.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { expectWithinBudget } from "./budgets.ts";

const CLI_ENTRY = fileURLToPath(new URL("../../../packages/cli/src/main.ts", import.meta.url));
/** Two boots plus a 30 s settle and the encode runs; a cold bundle build on a /mnt/c checkout adds minutes. */
const BENCH_TIMEOUT_MS = 600_000;

interface BenchServer {
  readonly status: "ok" | "fail";
  readonly error?: string;
  readonly readyMs?: number;
  readonly idleRssMb?: number;
}

/** The bench exits 1 when no encoder works; its JSON still carries the server numbers, so read stdout either way. */
async function runBench(): Promise<BenchServer> {
  const stdout = await promisify(execFile)(process.execPath, [CLI_ENTRY, "doctor", "--bench", "--json"], {
    timeout: BENCH_TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
  }).then(
    (result) => result.stdout,
    (error: { stdout?: string }) => error.stdout ?? "",
  );
  return (JSON.parse(stdout) as { server: BenchServer }).server;
}

test("the warm server is ready within 2 s and idles under 600 MB", async () => {
  test.setTimeout(BENCH_TIMEOUT_MS + 30_000);
  const server = await runBench();
  expect(server.status, server.error ?? "").toBe("ok");
  expectWithinBudget("serverReady", server.readyMs ?? Number.NaN);
  expectWithinBudget("serverIdleRss", server.idleRssMb ?? Number.NaN);
});
