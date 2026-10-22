// Created by The Angelo Umali.
// db/.lock: PGlite takes no directory lock, so two servers on one ZKS_HOME would corrupt it (plan §8).
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acquireProcessLock, DatabaseLockedError } from "../src/index.ts";

// Far above any real pid_max, so the liveness probe reports it dead.
const DEAD_PID = 2 ** 30;
let lockDir: string;
let lockPath: string;

beforeEach(async () => {
  lockDir = await mkdtemp(join(tmpdir(), "zks-lock-"));
  lockPath = join(lockDir, ".lock");
});

afterEach(async () => {
  await rm(lockDir, { recursive: true, force: true });
});

describe("acquireProcessLock", () => {
  it("writes this process's pid and removes the file on release", async () => {
    const release = await acquireProcessLock(lockPath);

    expect(await readFile(lockPath, "utf8")).toBe(String(process.pid));
    await release();
    await expect(readFile(lockPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses while a live process holds the lock", async () => {
    await writeFile(lockPath, String(process.pid));

    await expect(acquireProcessLock(lockPath)).rejects.toBeInstanceOf(DatabaseLockedError);
  });

  it("reclaims a lock left by a dead process", async () => {
    await writeFile(lockPath, String(DEAD_PID));

    const release = await acquireProcessLock(lockPath);

    expect(await readFile(lockPath, "utf8")).toBe(String(process.pid));
    await release();
  });

  it("reclaims a lock file whose content is not a pid", async () => {
    await writeFile(lockPath, "garbage");

    const release = await acquireProcessLock(lockPath);
    await release();
  });
});
