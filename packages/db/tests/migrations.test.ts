// Created by The Angelo Umali.
// The one migration set, applied to a real backend (plan §8): PGlite when DATABASE_URL is unset, Postgres when it is set.
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JOB_STATUSES, RULE_TEXT_MAX_CHARS } from "@zks/shared";
import * as schema from "../schema.ts";
import { openTestDatabase, textColumn, type TestDatabase } from "./test-database.ts";

const databaseUrl = process.env.DATABASE_URL;
const backendLabel = databaseUrl ? "postgres" : "pglite";
const schemaTables = Object.values(schema).filter((exported) => exported instanceof PgTable);
let database: TestDatabase;

beforeAll(async () => {
  database = await openTestDatabase(databaseUrl);
  await database.migrate();
}, 120_000);

afterAll(async () => {
  await database?.close();
});

describe(`drizzle migrations on ${backendLabel} (plan §8)`, () => {
  it("connects to the backend DATABASE_URL selects", async () => {
    const [version = ""] = textColumn(await database.rows(sql`select version()`), "version");

    expect(database.backend).toBe(backendLabel);
    // PGlite is pinned to its PG 17 line so both backends share Supabase's major (spike 03); only PGlite is wasm.
    expect(version).toMatch(/^PostgreSQL 17\./);
    if (databaseUrl) expect(version).not.toContain("wasm32");
    else expect(version).toContain("wasm32");
  });

  it("creates every schema.ts table, with schema.ts's columns, in the studio schema", async () => {
    const columnRows = await database.rows(
      sql`select table_name || '.' || column_name as qualified_column from information_schema.columns
          where table_schema = 'studio'`,
    );
    // Sorted in JS: collations differ between PGlite and Supabase.
    const migratedColumns = textColumn(columnRows, "qualified_column").sort();
    const declaredColumns = schemaTables
      .flatMap((table) => getTableConfig(table).columns.map((column) => `${getTableConfig(table).name}.${column.name}`))
      .sort();

    expect(migratedColumns).toEqual(declaredColumns);
  });

  it("creates the studio enums from the shared lists", async () => {
    const labelRows = await database.rows(
      sql`select e.enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'studio' and t.typname = 'job_status' order by e.enumsortorder`,
    );

    expect(textColumn(labelRows, "enumlabel")).toEqual([...JOB_STATUSES]);
  });

  it("enforces the rules text-length check", async () => {
    const checkRows = await database.rows(
      sql`select constraint_name from information_schema.table_constraints
          where table_schema = 'studio' and table_name = 'rules' and constraint_type = 'CHECK' and constraint_name = 'rules_text_length'`,
    );
    expect(checkRows).toHaveLength(1);

    await database.rows(sql`insert into studio.rules (text) values (${"x".repeat(RULE_TEXT_MAX_CHARS)})`);
    await expect(database.rows(sql`insert into studio.rules (text) values (${"x".repeat(RULE_TEXT_MAX_CHARS + 1)})`)).rejects.toThrow();
  });
});
