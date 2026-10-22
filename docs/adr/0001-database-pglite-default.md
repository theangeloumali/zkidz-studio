<!-- Created by The Angelo Umali. -->

# ADR 0001: PGlite by default, local Supabase as the opt-in, one Drizzle schema

- Status: Accepted
- Date: 2026-10-22
- Plan: D1, §5.4, §8

## Context

A creator should clone the repo and run it without Docker. Some users already run Supabase locally and want a real Postgres. A
`node:sqlite` default would need a second schema and a second migration set.

## Decision

- `DATABASE_URL` unset: PGlite (Postgres in WASM) inside the server process, data in `ZKS_HOME/db`, guarded by `db/.lock` because
  PGlite takes no directory lock.
- `DATABASE_URL=postgres://…` or `postgresql://…`: postgres.js against the local Supabase CLI stack (Postgres 17), started as
  Postgres only on port `SUPABASE_DB_PORT` = 45322 (`@zks/shared`). Ports stay below 49152: Hyper-V reserves 54xxx/55xxx ranges on
  Windows that move at boot, and 55322 failed to bind in spike 03.
- `supabase start` publishes Postgres on `0.0.0.0` and `[::]` under Docker Engine on WSL even on a `host_binding_ipv4=127.0.0.1`
  network (spike 03). Local mode therefore generates a random database password or binds `127.0.0.1:` explicitly, and `doctor`
  asserts the port is unreachable from a non-loopback interface.
- One Drizzle `pg-core` schema (`packages/db/schema.ts`), every table in the Postgres schema `studio`, never `public`.
- Postgres 17 on both backends: PGlite is pinned to 0.4.6, its last PG 17 line (0.5.x runs PG 18), and Supabase runs 17. The
  migration test asserts `PostgreSQL 17.` on each leg. No RLS and no `auth.users` foreign keys.
- Enums are built from the lists in `@zks/shared` so the API and the database cannot drift.
- Migrations come from `drizzle-kit generate` (never `push`), with hand-written rollback files. `pnpm db:test:matrix` applies them to
  in-memory PGlite, then to a throwaway database on the Supabase Postgres, and checks the catalog against `schema.ts` both times.

## Consequences

- Default install needs nothing beyond Node. PGlite costs about 390 MB RSS and serialises queries, so the request path avoids long
  transactions.
- The connection string is the only switch; the Connect screen shows the backend read-only.
