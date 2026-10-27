// Created by The Angelo Umali.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { inheritedParentEnv } from "../src/security/parent-env.ts";

const SERVER_MAIN = fileURLToPath(new URL("../src/main.ts", import.meta.url));
// A cold start of main.ts takes ~30 s on a DrvFs checkout and passed 60 s with parallel test runs on the machine.
const SPAWN_TIMEOUT_MS = 180_000;
// Stands in for a Postgres pool opened before the failure: a handle that keeps the event loop alive.
const HOLD_EVENT_LOOP = "data:text/javascript,setInterval(() => {}, 1e9)";
// Once the failure is logged the exit should follow at once; a hang fails here, not at the outer timeout.
const EXIT_AFTER_ERROR_MS = 10_000;
const FAILED_START = "studio server failed to start";

let studioHome = "";
afterEach(async () => {
  await rm(studioHome, { recursive: true, force: true });
});

describe("a studio server that fails to start", () => {
  it(
    "exits with code 1 and its error, even while something it opened still holds the event loop",
    async () => {
      studioHome = await mkdtemp(join(tmpdir(), "zks-start-failure-"));
      // An empty ZKS_HOME has none of the pinned tools, so startup throws (at ffprobe, or at Chrome when ffprobe is on PATH).
      const child = spawn(process.execPath, ["--import", HOLD_EVENT_LOOP, SERVER_MAIN], {
        // The OS basics a child needs on Windows too (SystemRoot, USERPROFILE, TEMP), and none of this machine's ZKS_* settings.
        env: { ...inheritedParentEnv({ proxyOptIn: false }), ZKS_HOME: studioHome, ZKS_PORT: "0", ZKS_PREVIEW_PORT: "0" },
        stdio: ["ignore", "ignore", "pipe"],
      });
      let stderr = "";
      const exitCode = await new Promise<number | null>((resolve) => {
        const giveUp = () => {
          child.kill("SIGKILL");
          resolve(null);
        };
        let guard = setTimeout(giveUp, SPAWN_TIMEOUT_MS - EXIT_AFTER_ERROR_MS);
        child.stderr.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
          if (!stderr.includes(FAILED_START)) return;
          clearTimeout(guard);
          guard = setTimeout(giveUp, EXIT_AFTER_ERROR_MS);
        });
        child.on("exit", (code) => {
          clearTimeout(guard);
          resolve(code);
        });
      });

      expect(stderr).toContain(FAILED_START);
      expect(exitCode).toBe(1);
    },
    SPAWN_TIMEOUT_MS,
  );
});
