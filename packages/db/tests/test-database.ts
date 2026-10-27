// Created by The Angelo Umali.
// Opens the backend the plan §8 switch selects: PGlite in memory when DATABASE_URL is unset, postgres.js otherwise.
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { MIGRATIONS_FOLDER } from "../src/index.ts";

export interface TestDatabase {
  readonly backend: "pglite" | "postgres";
  migrate(): Promise<void>;
  rows(query: SQL): Promise<Record<string, unknown>[]>;
  close(): Promise<void>;
}

export function openTestDatabase(databaseUrl: string | undefined): Promise<TestDatabase> {
  return databaseUrl ? openScratchPostgres(databaseUrl) : Promise.resolve(openPglite());
}

/** One text column of a result, so tests assert on strings without casting driver rows. */
export function textColumn(rows: Record<string, unknown>[], columnName: string): string[] {
  return rows.map((row) => row[columnName]).filter((value): value is string => typeof value === "string");
}

function openPglite(): TestDatabase {
  const client = new PGlite();
  const database = drizzlePglite(client);
  return {
    backend: "pglite",
    migrate: () => migratePglite(database, { migrationsFolder: MIGRATIONS_FOLDER }),
    rows: async (query) => (await database.execute(query)).rows,
    close: () => client.close(),
  };
}

// Migrates a throwaway database on the server, so a DATABASE_URL that points at real data is never touched.
async function openScratchPostgres(databaseUrl: string): Promise<TestDatabase> {
  const serverClient = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const scratchName = `zks_test_${randomUUID().replaceAll("-", "")}`;
  await serverClient.unsafe(`create database ${scratchName}`);
  const scratchUrl = new URL(databaseUrl);
  scratchUrl.pathname = `/${scratchName}`;
  const scratchClient = postgres(scratchUrl.href, { max: 1, onnotice: () => {} });
  const database = drizzlePostgres(scratchClient);
  return {
    backend: "postgres",
    migrate: () => migratePostgres(database, { migrationsFolder: MIGRATIONS_FOLDER }),
    rows: async (query) => [...(await database.execute(query))],
    close: async () => {
      await scratchClient.end();
      await serverClient.unsafe(`drop database ${scratchName}`);
      await serverClient.end();
    },
  };
}
