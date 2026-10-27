// Created by The Angelo Umali.
// The real engine CLI must accept every command the server spawns: fake runners elsewhere cannot catch a missing one.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { INGEST_MODES } from "@zks/shared";
import { describe, expect, it } from "vitest";
import { ENGINE_COMMANDS } from "../../src/tools/engine-jobs.ts";

const runFile = promisify(execFile);
const ENGINE_DIR = fileURLToPath(new URL("../../../../packages/engine", import.meta.url));
// uv resolves the engine's venv before Python starts; on a busy machine that alone outruns vitest's 5 s default.
const UV_TIMEOUT_MS = 120_000;

async function engineHelp(command: string): Promise<string> {
  const { stdout } = await runFile("uv", ["run", "--project", ENGINE_DIR, "zks-engine", command, "--help"], { timeout: UV_TIMEOUT_MS });
  return stdout;
}

describe("zks-engine CLI contract", () => {
  it.each(ENGINE_COMMANDS)(
    "accepts `%s --json`",
    async (command) => {
      expect(await engineHelp(command)).toContain("--json");
    },
    UV_TIMEOUT_MS,
  );

  it(
    "takes every ingest mode the server stores",
    async () => {
      const help = await engineHelp("ingest");
      for (const mode of INGEST_MODES) expect(help).toContain(mode);
    },
    UV_TIMEOUT_MS,
  );
});
