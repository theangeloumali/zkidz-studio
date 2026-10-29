// Created by The Angelo Umali.
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isVersionAtLeast, readAgentVersion, resolveAgentBinary } from "../../../src/terminal/agents/agent-binary.ts";

async function binDirWith(fileName: string, script: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "zks-agent-bin-"));
  await writeFile(join(dir, fileName), script);
  await chmod(join(dir, fileName), 0o755);
  return dir;
}

describe.skipIf(process.platform === "win32")("resolveAgentBinary", () => {
  it("finds the bare name in an absolute PATH dir", async () => {
    const dir = await binDirWith("codex", "#!/bin/sh\n");
    expect(await resolveAgentBinary(["codex", "codex.exe", "codex.cmd"], { PATH: `relative:${dir}` })).toBe(join(dir, "codex"));
  });

  it("is null when the binary is missing or only on a relative PATH entry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zks-agent-bin-"));
    await mkdir(join(dir, "bin"));
    expect(await resolveAgentBinary(["codex"], { PATH: `${dir}:bin` })).toBeNull();
  });

  it("only looks for names with an extension on Windows", async () => {
    const dir = await binDirWith("codex", "#!/bin/sh\n");
    expect(await resolveAgentBinary(["codex", "codex.exe"], { PATH: dir }, "win32")).toBeNull();
  });
});

describe.skipIf(process.platform === "win32")("readAgentVersion", () => {
  it("finds the version anywhere in the output, as codex prints it", async () => {
    const dir = await binDirWith("codex", "#!/bin/sh\necho 'codex-cli 0.164.0'\n");
    expect(await readAgentVersion(join(dir, "codex"), ["--version"])).toBe("0.164.0");
  });

  it("is null when the binary is missing or prints no version", async () => {
    const dir = await binDirWith("opencode", "#!/bin/sh\necho hello\n");
    expect(await readAgentVersion(join(dir, "opencode"), ["--version"])).toBeNull();
    expect(await readAgentVersion(null, ["--version"])).toBeNull();
  });
});

describe("isVersionAtLeast", () => {
  it.each([
    ["0.164.0", "0.164.0", true],
    ["0.165.1", "0.164.0", true],
    ["1.0.0", "0.164.0", true],
    ["0.99.9", "0.164.0", false],
    ["2.1.9-beta", "2.2.0", false],
    ["not a version", "2.2.0", false],
  ])("%s against %s is %s", (version, minVersion, isAtLeast) => {
    expect(isVersionAtLeast(version, minVersion)).toBe(isAtLeast);
  });
});
