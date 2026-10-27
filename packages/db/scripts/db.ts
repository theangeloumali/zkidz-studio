// Created by The Angelo Umali.
// db:backup | db:restore <file> | db:reset | db:rollback --to <NNNN>, on the backend DATABASE_URL selects (plan §8).
// Every command that changes data writes a backup to ZKS_HOME/backups first, so each one can be undone with db:restore.
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { ENV } from "@zks/shared";
import { defaultZksHome } from "@zks/shared/node";
import { openDatabase, rollbackMigrations } from "../src/index.ts";
import { type BackupCommand, parseBackupArgs, resetDatabase, restoreStudioData, writeBackup } from "./backup.ts";

const USAGE_EXIT_CODE = 2;

async function main(argv: readonly string[]): Promise<void> {
  let command: BackupCommand;
  try {
    command = parseBackupArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = USAGE_EXIT_CODE;
    return;
  }
  // Read before opening anything: a wrong path fails without a safety backup or a lock.
  const backupText = command.command === "restore" ? await readFile(command.backupFile, "utf8") : "";
  const zksHome = defaultZksHome({ env: process.env, platform: process.platform, homeDir: homedir() });
  const handle = await openDatabase({ dataDir: join(zksHome, "db"), databaseUrl: process.env[ENV.databaseUrl] || undefined });
  try {
    const backupPath = await writeBackup(handle, join(zksHome, "backups"));
    console.log(`Backup written: ${backupPath}`);
    if (command.command === "restore") {
      await restoreStudioData(handle, backupText);
      console.log(`Restored ${command.backupFile}`);
    } else if (command.command === "reset") {
      await resetDatabase(handle);
      console.log("Database reset to the migrated schema and the sample project.");
    } else if (command.command === "rollback") {
      await rollbackMigrations(handle, { keepThrough: command.keepThrough });
      console.log(`Rolled back every migration after ${String(command.keepThrough).padStart(4, "0")}.`);
    }
  } finally {
    await handle.close();
  }
}

try {
  await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
