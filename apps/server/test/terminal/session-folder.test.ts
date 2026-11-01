// Created by The Angelo Umali.
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionFolder, removeSessionFiles, withSessionFolder, writeSessionFile } from "../../src/terminal/session-files.ts";

const SESSION_ID = "0b0f6c0e-1f9b-4c1e-9d55-1a2b3c4d5e6f";
const modeOf = async (path: string) => (await stat(path)).mode & 0o777;

describe.skipIf(process.platform === "win32")("session folders", () => {
  it("writes owner-only files in an owner-only folder under the run dir, and removes them", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "zks-run-"));
    const filesDir = await createSessionFolder(runDir, SESSION_ID);
    const filePath = await writeSessionFile(filesDir, "opencode.json", "{}");

    expect(dirname(filesDir)).toBe(runDir);
    expect(await modeOf(filesDir)).toBe(0o700);
    expect(await modeOf(filePath)).toBe(0o600);
    expect(await readFile(filePath, "utf8")).toBe("{}");

    await removeSessionFiles({ dir: filesDir });
    await expect(stat(filesDir)).rejects.toThrow();
  });

  it("creates the run dir when it is missing, as it is after every server start", async () => {
    const runDir = join(await mkdtemp(join(tmpdir(), "zks-home-")), "run");
    const filesDir = await createSessionFolder(runDir, SESSION_ID);

    expect(dirname(filesDir)).toBe(runDir);
    expect(await modeOf(runDir)).toBe(0o700);
  });

  it("never overwrites a file that is already there", async () => {
    const filesDir = await createSessionFolder(await mkdtemp(join(tmpdir(), "zks-run-")), SESSION_ID);
    await writeSessionFile(filesDir, "instructions.md", "first");
    await expect(writeSessionFile(filesDir, "instructions.md", "second")).rejects.toThrow();
  });

  it("removes the folder when a later step of the launch throws", async () => {
    const runDir = await mkdtemp(join(tmpdir(), "zks-run-"));
    const failed = withSessionFolder(runDir, SESSION_ID, async (dir) => {
      await writeSessionFile(dir, "opencode.json", "{}");
      throw new Error("no credential");
    });

    await expect(failed).rejects.toThrow("no credential");
    expect(await readdir(runDir)).toEqual([]);
  });

  it("refuses a session id that is not a studio id", async () => {
    await expect(createSessionFolder(await mkdtemp(join(tmpdir(), "zks-run-")), "../escape")).rejects.toThrow();
  });
});
