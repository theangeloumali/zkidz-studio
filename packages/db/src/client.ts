// Created by The Angelo Umali.
// The one switch (plan §8): DATABASE_URL unset → PGlite in dataDir; postgres:// or postgresql:// → postgres.js.
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import type { SQL } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../schema.ts";
import { acquireProcessLock } from "./lock.ts";

// fileURLToPath, not .pathname: on Windows .pathname yields "/C:/..." and keeps %20 escapes.
export const MIGRATIONS_FOLDER = fileURLToPath(new URL("../migrations", import.meta.url));
export const LOCK_FILE_NAME = ".lock";

export type DatabaseBackend = "pglite" | "postgres";
export type StudioDatabase = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Raw SQL access shared by the real client and the test harness (rollback runs on both). */
export interface SqlRunner {
  rows(query: SQL): Promise<Record<string, unknown>[]>;
}

export interface StudioDatabaseHandle extends SqlRunner {
  readonly backend: DatabaseBackend;
  readonly db: StudioDatabase;
  migrate(): Promise<void>;
  close(): Promise<void>;
}

export interface OpenDatabaseOptions {
  /** PGlite's directory, ZKS_HOME/db; unused on Postgres. */
  readonly dataDir: string;
  readonly databaseUrl?: string | undefined;
}

export function selectBackend(databaseUrl: string | undefined): DatabaseBackend {
  if (!databaseUrl) return "pglite";
  if (/^postgres(ql)?:\/\//.test(databaseUrl)) return "postgres";
  throw new Error("DATABASE_URL must start with postgres:// or postgresql://, or be unset for the built-in database.");
}

export function openDatabase(options: OpenDatabaseOptions): Promise<StudioDatabaseHandle> {
  return selectBackend(options.databaseUrl) === "postgres" && options.databaseUrl
    ? Promise.resolve(openPostgres(options.databaseUrl))
    : openPglite(options.dataDir);
}

async function openPglite(dataDir: string): Promise<StudioDatabaseHandle> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const releaseLock = await acquireProcessLock(join(dataDir, LOCK_FILE_NAME));
  try {
    const client = await PGlite.create(dataDir);
    const db = drizzlePglite(client, { schema });
    return {
      backend: "pglite",
      db,
      migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }),
      rows: async (query) => (await db.execute(query)).rows,
      close: async () => {
        await client.close();
        await releaseLock();
      },
    };
  } catch (error) {
    await releaseLock();
    throw error;
  }
}

function openPostgres(databaseUrl: string): StudioDatabaseHandle {
  const client = postgres(databaseUrl, { onnotice: () => {} });
  const db = drizzlePostgres(client, { schema });
  return {
    backend: "postgres",
    db,
    migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER }),
    rows: async (query) => [...(await db.execute(query))],
    close: () => client.end(),
  };
}
