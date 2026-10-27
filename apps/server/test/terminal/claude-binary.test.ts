// Created by The Angelo Umali.
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readClaudeVersion, resolveClaudePath } from "../../src/terminal/claude-binary.ts";

const isWindows = process.platform === "win32";

describe.skipIf(isWindows)("claude binary resolution", () => {
  let scratchDir = "";
  beforeEach(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), "zks-claude-bin-"));
  });
  afterEach(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  async function writeExecutable(dir: string, script: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const path = join(dir, "claude");
    await writeFile(path, `#!/bin/sh\n${script}\n`);
    await chmod(path, 0o755);
    return path;
  }

  it("finds the first executable claude on PATH, skipping relative and non-executable entries", async () => {
    const notExecutable = join(scratchDir, "plain");
    await mkdir(notExecutable);
    await writeFile(join(notExecutable, "claude"), "not a program");
    const expected = await writeExecutable(join(scratchDir, "bin"), "exit 0");
    const searchPath = ["relative/bin", notExecutable, join(scratchDir, "bin")].join(delimiter);

    expect(await resolveClaudePath({ PATH: searchPath }, "linux")).toBe(expected);
  });

  it("answers null when no claude is installed", async () => {
    expect(await resolveClaudePath({ PATH: scratchDir }, "linux")).toBeNull();
    expect(await resolveClaudePath({}, "linux")).toBeNull();
  });

  it("reads the version line, or null when the binary fails", async () => {
    const working = await writeExecutable(join(scratchDir, "ok"), 'echo "2.1.300 (Claude Code)"');
    const broken = await writeExecutable(join(scratchDir, "broken"), "exit 3");

    expect(await readClaudeVersion(working)).toBe("2.1.300");
    expect(await readClaudeVersion(broken)).toBeNull();
    expect(await readClaudeVersion(null)).toBeNull();
  });
});
