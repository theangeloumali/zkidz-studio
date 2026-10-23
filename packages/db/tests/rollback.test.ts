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
});
