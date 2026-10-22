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
  Postgres only on a loopback-bound Docker network.
- One Drizzle `pg-core` schema (`packages/db/schema.ts`), every table in the Postgres schema `studio`, never `public`.
- Postgres 17 features only, because PGlite ships 18 and Supabase 17. No RLS and no `auth.users` foreign keys.
- Enums are built from the lists in `@zks/shared` so the API and the database cannot drift.
- Migrations come from `drizzle-kit generate` (never `push`), with hand-written rollback files. CI runs up, down, up on both backends
  (`pnpm db:test:matrix`).

## Consequences

- Default install needs nothing beyond Node. PGlite costs about 390 MB RSS and serialises queries, so the request path avoids long
  transactions.
- The connection string is the only switch; the Connect screen shows the backend read-only.
