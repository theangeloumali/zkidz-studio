// Created by The Angelo Umali.
// drizzle-kit writes no down files, so each migration NNNN has a hand-written rollback/NNNN.down.sql.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { MIGRATIONS_FOLDER, type SqlRunner } from "./client.ts";

const ROLLBACK_FOLDER = fileURLToPath(new URL("../rollback", import.meta.url));
const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

export function rollbackFileName(migrationIndex: number): string {
  return `${String(migrationIndex).padStart(4, "0")}.down.sql`;
}

/** Undoes every applied migration after `keepThrough` (an index; -1 undoes them all), newest first. */
export async function rollbackMigrations(runner: SqlRunner, { keepThrough }: { keepThrough: number }): Promise<void> {
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  for (let index = migrations.length - 1; index > keepThrough; index--) {
    const migration = migrations[index];
    if (!migration || !(await isApplied(runner, migration.folderMillis))) continue;
    const downSql = await readFile(`${ROLLBACK_FOLDER}/${rollbackFileName(index)}`, "utf8");
    // Both drivers use the extended protocol, which takes one statement per query.
    for (const statement of downSql.split(STATEMENT_BREAKPOINT)) {
      if (statement.trim()) await runner.rows(sql.raw(statement));
    }
    // The migrator replays anything newer than its last row, so the row goes with the schema.
    await runner.rows(sql`delete from drizzle.__drizzle_migrations where created_at = ${migration.folderMillis}`);
  }
}

async function isApplied(runner: SqlRunner, folderMillis: number): Promise<boolean> {
  const [tableRow] = await runner.rows(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`);
  if (tableRow?.present !== true) return false;
  const appliedRows = await runner.rows(sql`select 1 from drizzle.__drizzle_migrations where created_at = ${folderMillis}`);
  return appliedRows.length > 0;
}
