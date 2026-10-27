// Created by The Angelo Umali.
// Spike 3: run the same drizzle migrations on PGlite and on DATABASE_URL, then diff version and catalog.
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import postgres from "postgres";

const MIGRATIONS = {
  migrationsFolder: new URL("./migrations", import.meta.url).pathname,
};

// Ordered so the two dumps compare line by line; defaults are text, so type spellings surface too.
const CATALOG_QUERIES = {
  columns: sql`select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns
               where table_schema = 'studio' order by table_name, ordinal_position`,
  constraints: sql`select tc.table_name, tc.constraint_type, kcu.column_name from information_schema.table_constraints tc
                   join information_schema.key_column_usage kcu using (constraint_schema, constraint_name)
                   where tc.table_schema = 'studio' order by 1, 2, 3`,
  indexes: sql`select tablename, indexname, indexdef from pg_indexes where schemaname = 'studio' order by 1, 2`,
  migrations: sql`select count(*)::int as applied from drizzle.__drizzle_migrations`,
};

async function dumpCatalog(database) {
  const rowsOf = (result) => result.rows ?? result;
  const dump = {
    version: rowsOf(await database.execute(sql`select version()`))[0].version,
  };
  for (const [name, query] of Object.entries(CATALOG_QUERIES)) dump[name] = rowsOf(await database.execute(query));
  return dump;
}

const pglite = new PGlite();
const pgliteDatabase = drizzlePglite(pglite);
await migratePglite(pgliteDatabase, MIGRATIONS);
const pgliteDump = await dumpCatalog(pgliteDatabase);
await pglite.close();

let postgresDump = null;
if (process.env.DATABASE_URL) {
  const client = postgres(process.env.DATABASE_URL, {
    max: 1,
    onnotice: () => {},
  });
  const postgresDatabase = drizzlePostgres(client);
  await migratePostgres(postgresDatabase, MIGRATIONS);
  postgresDump = await dumpCatalog(postgresDatabase);
  await client.end();
}

const sections = Object.keys(CATALOG_QUERIES);
const differences = postgresDump
  ? sections.filter((section) => JSON.stringify(pgliteDump[section]) !== JSON.stringify(postgresDump[section]))
  : ["no DATABASE_URL: Supabase side skipped"];

console.log(JSON.stringify({ pglite: pgliteDump, postgres: postgresDump, differences }, null, 2));
process.exitCode = postgresDump && differences.length === 0 ? 0 : 1;
