// Created by The Angelo Umali.
import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectTerminalAgentVersions } from "../../../src/terminal/agents/agent-versions.ts";

async function fakeBinary(dir: string, name: string, output: string): Promise<void> {
  const path = join(dir, name);
  await writeFile(path, `#!/bin/sh\necho "${output}"\n`);
  await chmod(path, 0o755);
}

describe.skipIf(process.platform === "win32")("detectTerminalAgentVersions", () => {
  it("reads each agent's --version from PATH with the oldest supported version beside it", async () => {
    const binDir = await mkdtemp(join(tmpdir(), "zks-agent-bin-"));
    await fakeBinary(binDir, "codex", "codex-cli 0.165.0");
    await fakeBinary(binDir, "opencode", "2.2.0");
    expect(await detectTerminalAgentVersions({ PATH: binDir }, "linux")).toEqual({
      codex: { version: "0.165.0", minVersion: "0.164.0" },
      opencode: { version: "2.2.0", minVersion: "2.2.0" },
    });
  });

  it("reports null for an agent that is not installed", async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), "zks-agent-bin-"));
    expect(await detectTerminalAgentVersions({ PATH: emptyDir }, "linux")).toEqual({
      codex: { version: null, minVersion: "0.164.0" },
      opencode: { version: null, minVersion: "2.2.0" },
    });
  });
});
