// Created by The Angelo Umali.
// Logical backups of the studio schema that load on either backend (plan §8), plus reset and the CLI's argument parser.
// Rows travel as JSON through json_populate_record, so Postgres does every type conversion; pg_dump's output needs psql.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { MIGRATIONS_FOLDER, rollbackMigrations, seedDatabase, type SqlRunner, type StudioDatabaseHandle } from "../src/index.ts";

const BACKUP_MAGIC = "-- zkidz-studio backup v1";
const MIGRATION_HEADER = /^-- migrations: (\d+) ?(\S*)$/m;
// One quoted literal and nothing after it; %L writes E'...' when the JSON holds a backslash.
const ROW_STATEMENT =
  /^INSERT INTO studio\.[a-z_]+ OVERRIDING SYSTEM VALUE SELECT \* FROM json_populate_record\(NULL::studio\.[a-z_]+, (?:'(?:[^']|'')*'|E'(?:[^'\\]|''|\\.)*')\);$/;
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;
const USAGE = "Usage: db.ts backup | restore <file.sql> | reset | rollback --to <NNNN>";

export type BackupCommand =
  | { readonly command: "backup" }
  | { readonly command: "reset" }
  | { readonly command: "restore"; readonly backupFile: string }
  | { readonly command: "rollback"; readonly keepThrough: number };

/** How many of the repo's migrations, in order, the database has applied. */
export async function appliedMigrationCount(runner: SqlRunner): Promise<number> {
  const [tableRow] = await runner.rows(sql`select to_regclass('drizzle.__drizzle_migrations') is not null as present`);
  if (tableRow?.present !== true) return 0;
  const appliedRows = await runner.rows(sql`select created_at from drizzle.__drizzle_migrations`);
  // int8 arrives as a string from postgres.js and as a number from PGlite.
  const appliedMillis = new Set(appliedRows.map((row) => Number(row.created_at)));
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  let appliedCount = 0;
  while (appliedCount < migrations.length && appliedMillis.has(migrations[appliedCount]?.folderMillis ?? Number.NaN)) appliedCount++;
  return appliedCount;
}

export async function dumpStudioData(runner: SqlRunner): Promise<string> {
  const migrationCount = await appliedMigrationCount(runner);
  const lastHash = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })[migrationCount - 1]?.hash ?? "";
  const lines = [BACKUP_MAGIC, `-- migrations: ${migrationCount} ${lastHash}`];
  for (const table of await studioTables(runner)) {
    const statementRows = await runner.rows(
      sql`select format('INSERT INTO studio.%I OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_record(NULL::studio.%I, %L);',
                        ${table}::text, ${table}::text, row_to_json(source_row)::text) as statement
          from studio.${sql.identifier(table)} source_row order by 1`,
    );
    lines.push(...stringColumn(statementRows, "statement"));
  }
  return `${lines.join("\n")}\n`;
}

export async function writeBackup(runner: SqlRunner, backupsDir: string): Promise<string> {
  await mkdir(backupsDir, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
  const timestamp = new Date().toISOString().replaceAll(":", "-").replace(".", "-");
  const backupPath = join(backupsDir, `studio-${timestamp}.sql`);
  await writeFile(backupPath, await dumpStudioData(runner), { flag: "wx", mode: OWNER_ONLY_FILE_MODE });
  return backupPath;
}

/** Replaces every studio row with the backup's, at the backup's migration level, then migrates to this release. */
export async function restoreStudioData(handle: StudioDatabaseHandle, backupText: string): Promise<void> {
  const { migrationCount, statements } = parseBackup(backupText);
  await handle.migrate();
  await rollbackMigrations(handle, { keepThrough: migrationCount - 1 });
  const tables = await studioTables(handle);
  const identityColumns = await studioIdentityColumns(handle);
  await handle.db.transaction(async (transaction) => {
    // Skips foreign-key triggers for this transaction: projects ↔ agent_sessions reference each other, and the dump is consistent.
    await transaction.execute(sql`set local session_replication_role = replica`);
    if (tables.length > 0) {
      await transaction.execute(
        sql`truncate table ${sql.join(
          tables.map((table) => sql`studio.${sql.identifier(table)}`),
          sql`, `,
        )}`,
      );
    }
    for (const statement of statements) await transaction.execute(sql.raw(statement));
    for (const { table, column } of identityColumns) {
      await transaction.execute(
        sql`select setval(pg_get_serial_sequence(format('studio.%I', ${table}::text), ${column}::text),
                          coalesce(max(${sql.identifier(column)}), 0) + 1, false)
            from studio.${sql.identifier(table)}`,
      );
    }
  });
  await handle.migrate();
}

/** `db:reset`: every migration down, up again, then the sample project. The CLI takes a backup first. */
export async function resetDatabase(handle: StudioDatabaseHandle): Promise<void> {
  await rollbackMigrations(handle, { keepThrough: -1 });
  await handle.migrate();
  await seedDatabase(handle.db);
}

export function parseBackupArgs(argv: readonly string[]): BackupCommand {
  // pnpm forwards the `--` in `pnpm db:rollback -- --to 0000`.
  const [command, ...rest] = argv.filter((argument) => argument !== "--");
  if (command === "backup" || command === "reset") {
    if (rest.length === 0) return { command };
  } else if (command === "restore") {
    const [backupFile, ...extra] = rest;
    if (backupFile && extra.length === 0) return { command, backupFile };
  } else if (command === "rollback") {
    const [flag, target, ...extra] = rest;
    if (flag === "--to" && target && /^\d{4}$/.test(target) && extra.length === 0) return { command, keepThrough: Number(target) };
  }
  throw new Error(USAGE);
}

function parseBackup(backupText: string): { migrationCount: number; statements: string[] } {
  const lines = backupText.split(/\r?\n/).filter((line) => line !== "");
  const header = MIGRATION_HEADER.exec(backupText);
  const statements = lines.filter((line) => !line.startsWith("--"));
  if (lines[0] !== BACKUP_MAGIC || !header || !statements.every((statement) => ROW_STATEMENT.test(statement))) {
    throw new Error("This file is not a zkidz-studio backup (db:backup writes them); nothing was changed.");
  }
  const migrationCount = Number(header[1]);
  const migrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });
  if (migrationCount > migrations.length) {
    throw new Error(`The backup is from a newer release (${migrationCount} migrations, this one has ${migrations.length}); nothing was changed.`);
  }
  if ((migrations[migrationCount - 1]?.hash ?? "") !== (header[2] ?? "")) {
    throw new Error("The backup's migration history does not match this release's migrations; nothing was changed.");
  }
  return { migrationCount, statements };
}

async function studioTables(runner: SqlRunner): Promise<string[]> {
  const tableRows = await runner.rows(
    sql`select table_name from information_schema.tables where table_schema = 'studio' and table_type = 'BASE TABLE' order by table_name`,
  );
  return stringColumn(tableRows, "table_name");
}

async function studioIdentityColumns(runner: SqlRunner): Promise<{ table: string; column: string }[]> {
  const columnRows = await runner.rows(
    sql`select table_name, column_name from information_schema.columns
        where table_schema = 'studio' and (is_identity = 'YES' or column_default like 'nextval(%')`,
  );
  return columnRows.flatMap((row) =>
    typeof row.table_name === "string" && typeof row.column_name === "string" ? [{ table: row.table_name, column: row.column_name }] : [],
  );
}

function stringColumn(rows: Record<string, unknown>[], columnName: string): string[] {
  return rows.map((row) => row[columnName]).filter((value): value is string => typeof value === "string");
}
