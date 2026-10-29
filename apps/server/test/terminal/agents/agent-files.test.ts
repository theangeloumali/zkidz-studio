// Created by The Angelo Umali.
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAgentFilesDir, removeAgentFiles, writeAgentFile } from "../../../src/terminal/agents/agent-files.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe.skipIf(process.platform === "win32")("agent session files", () => {
  it("writes owner-only files in an owner-only folder under the run dir, and removes them", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "zks-run-"));
    const filesDir = await createAgentFilesDir(runDir, SESSION_ID);
    const filePath = await writeAgentFile(filesDir, "opencode.json", "{}");

    expect(dirname(filesDir)).toBe(runDir);
    expect(await modeOf(filesDir)).toBe(0o700);
    expect(await modeOf(filePath)).toBe(0o600);
    expect(await readFile(filePath, "utf8")).toBe("{}");

    await removeAgentFiles(filesDir);
    await expect(stat(filesDir)).rejects.toThrow();
  });

  it("never overwrites a file that is already there", async () => {
    const filesDir = await createAgentFilesDir(await mkdtemp(join(tmpdir(), "zks-run-")), SESSION_ID);
    await writeAgentFile(filesDir, "instructions.md", "first");
    await expect(writeAgentFile(filesDir, "instructions.md", "second")).rejects.toThrow();
  });

  it("refuses a session id that is not a studio id", async () => {
    await expect(createAgentFilesDir(await mkdtemp(join(tmpdir(), "zks-run-")), "../escape")).rejects.toThrow();
  });
});
