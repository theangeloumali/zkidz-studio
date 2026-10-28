// Created by The Angelo Umali.
// The db:backup / db:restore / db:reset / db:rollback entry point, run as the integrator's package scripts run it.
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const DB_CLI = fileURLToPath(new URL("../db.ts", import.meta.url));
// Four cold CLI starts in a row: 20–40 s each on a busy /mnt checkout (128–142 s measured), so 120 s timed out.
const TEST_TIMEOUT_MS = 240_000;
const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function scratchHome(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "zks-db-cli-"));
  scratchDirs.push(directory);
  return directory;
}

// DATABASE_URL is blanked so the CLI uses PGlite under the scratch home, never a real database.
function runDbCli(zksHome: string, args: string[]) {
  return spawnSync(process.execPath, [DB_CLI, ...args], { encoding: "utf8", env: { ...process.env, ZKS_HOME: zksHome, DATABASE_URL: "" } });
}

describe("db.ts", () => {
  it(
    "backs up, then restores and rolls back with a safety backup before each",
    async () => {
      const zksHome = await scratchHome();

      const backup = runDbCli(zksHome, ["backup"]);
      expect(backup.status, backup.stderr).toBe(0);
      const [backupFile] = await readdir(join(zksHome, "backups"));
      expect(backup.stdout).toContain(join(zksHome, "backups", backupFile ?? "missing"));

      const restore = runDbCli(zksHome, ["restore", join(zksHome, "backups", backupFile ?? "missing")]);
      expect(restore.status, restore.stderr).toBe(0);
      const rollback = runDbCli(zksHome, ["rollback", "--", "--to", "0000"]);
      expect(rollback.status, rollback.stderr).toBe(0);
      const reset = runDbCli(zksHome, ["reset"]);
      expect(reset.status, reset.stderr).toBe(0);

      expect(await readdir(join(zksHome, "backups"))).toHaveLength(4);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "exits 2 with the usage line on an unknown command, without opening the database",
    async () => {
      const zksHome = await scratchHome();
      const result = runDbCli(zksHome, ["drop"]);

      expect(result.status).toBe(2);
      expect(result.stderr).toMatch(/usage/i);
      expect(await readdir(zksHome)).toEqual([]);
    },
    TEST_TIMEOUT_MS,
  );
});
