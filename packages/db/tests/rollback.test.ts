// Created by The Angelo Umali.
// Every migration has a hand-written down file, and up → down → up leaves the same catalog (plan §8).
import { readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { MIGRATIONS_FOLDER, rollbackFileName, rollbackMigrations } from "../src/index.ts";
import { openTestDatabase, textColumn, type TestDatabase } from "./test-database.ts";

const ROLLBACK_FOLDER = fileURLToPath(new URL("../rollback", import.meta.url));
const studioTablesQuery = sql`select table_name from information_schema.tables where table_schema = 'studio'`;
let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase(process.env.DATABASE_URL);
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe("rollback", () => {
  it("has a down file for every migration", async () => {
    const migrationCount = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;
    const downFiles = await readdir(ROLLBACK_FOLDER);

    for (let index = 0; index < migrationCount; index++) expect(downFiles).toContain(rollbackFileName(index));
  });

  it("names down files NNNN.down.sql", () => {
    expect(rollbackFileName(0)).toBe("0000.down.sql");
    expect(rollbackFileName(12)).toBe("0012.down.sql");
  });

  it("goes up, down to nothing, and up again to the same tables", async () => {
    await database.migrate();
    const tablesAfterFirstUp = textColumn(await database.rows(studioTablesQuery), "table_name").sort();

    await rollbackMigrations(database, { keepThrough: -1 });
    const tablesAfterDown = textColumn(await database.rows(studioTablesQuery), "table_name");

    await database.migrate();
    const tablesAfterSecondUp = textColumn(await database.rows(studioTablesQuery), "table_name").sort();

    expect(tablesAfterFirstUp.length).toBeGreaterThan(0);
    expect(tablesAfterDown).toEqual([]);
    expect(tablesAfterSecondUp).toEqual(tablesAfterFirstUp);
  }, 120_000);

  it("takes 0001 back to 0000's catalog, rebuilding asset_kind without reference, and forward again", async () => {
    const assetKindsQuery = sql`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'studio' and t.typname = 'asset_kind' order by e.enumsortorder`;
    const styleColumnQuery = sql`select 1 from information_schema.columns where table_schema = 'studio' and table_name = 'projects' and column_name = 'style'`;
    await database.migrate();
    const [project] = await database.rows(sql`insert into studio.projects (slug, title) values ('rollback-0001', 'R') returning id`);
    await database.rows(
      sql`insert into studio.media_assets (project_id, kind, name, rel_path, bytes, mtime_ms) values (${project?.id}, 'reference', 'ref.mp4', 'ref.mp4', 1, 1)`,
    );

    await rollbackMigrations(database, { keepThrough: 0 });
    const tablesAfterDown = textColumn(await database.rows(studioTablesQuery), "table_name");
    expect(tablesAfterDown).not.toContain("edits");
    expect(await database.rows(styleColumnQuery)).toEqual([]);
    expect(textColumn(await database.rows(assetKindsQuery), "enumlabel")).not.toContain("reference");
    expect(await database.rows(sql`select 1 from studio.media_assets where kind::text = 'reference'`)).toEqual([]);

    await database.migrate();
    expect(textColumn(await database.rows(studioTablesQuery), "table_name")).toContain("edits");
    expect(textColumn(await database.rows(assetKindsQuery), "enumlabel")).toContain("reference");
    await database.rows(sql`delete from studio.projects where slug = 'rollback-0001'`);
  }, 120_000);
});
