<!-- Created by The Angelo Umali. -->

# Spike 3: Supabase Postgres-only and drizzle on PGlite

**Status: PASS** for drizzle migrations: PGlite and Supabase Postgres produce identical catalogs. **FAIL** for the plan's
§8 network assumptions: the plan's ports collide with a Windows reserved range, and Postgres binds to every interface,
not loopback.

## Goal

Plan §8: local mode runs `supabase start` with only Postgres. The tests and the no-Docker fallback run drizzle on PGlite.
Do both backends end up with the same schema from one migration set, and does the local stack stay on loopback?

## Commands

```bash
cd docs/spikes/03-db-backends
pnpm install --ignore-workspace     # pglite 0.5.11, drizzle-orm 0.45.4, drizzle-kit 0.31.11, postgres 3.4.9
pnpm generate                       # drizzle-kit generate --config drizzle.config.mjs -> migrations/
docker network create -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 zks-spike-03-net
supabase start --workdir . --network-id zks-spike-03-net \
  -x gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:45322/postgres pnpm compare
supabase stop --workdir . --no-backup && docker network rm zks-spike-03-net
```

`compare.mjs` migrates an in-memory PGlite and the Supabase database, dumps version, columns, constraints, indexes and
the applied-migration count of the `studio` schema, then diffs them. It exits 0 only when there are no differences.
Full dump: `results-compare.json`.

## Output excerpts

```text
Error: Bind for 0.0.0.0:55322 failed: port is already allocated          # plan's port, Windows host
netsh int ipv4 show excludedportrange: 55315 - 55414 (Hyper-V reserved)
# moved to 45320-45323 in supabase/config.toml
Started supabase local development setup.   (Postgres only, ~22 s)
docker port: 5432/tcp -> 0.0.0.0:45322, [::]:45322                        # despite host_binding_ipv4=127.0.0.1
psql from a LAN interface and a VPN interface with postgres:postgres: connected
pglite:   PostgreSQL 18.6 (PGlite 0.5.11) on wasm32-unknown-emscripten
supabase: PostgreSQL 17.11 on x86_64-pc-linux-gnu  (public.ecr.aws/supabase/postgres:17.11.0.004)
differences: []    compare exit 0
```

Cleanup verified afterwards: no `zks-spike-03` containers, volumes or network remain. Other Supabase projects on the
host were not touched.

## Decision for the plan

1. **One drizzle migration set serves both backends.** Keep it, but pin the major version: PGlite runs PostgreSQL 18 and
   Supabase runs 17. Either pin PGlite to a PG 17 build or have CI reject PG 18-only features in migrations.
2. **Do not use 54xxx or 55xxx ports on Windows.** Hyper-V reserves ranges there that change at boot. Pick defaults below
   49152 (this spike used 45320-45323), and have `doctor` check `excludedportrange` before starting.
3. **The §8 "Postgres is only on loopback" claim is false on Docker Engine under WSL.** `supabase start` publishes the port
   on 0.0.0.0 and [::] with the default `postgres` password, and the network's `host_binding_ipv4` option is ignored.
   Local mode must either generate a random database password or start Postgres with an explicit `127.0.0.1:` port
   binding, and `doctor` must assert that the port is not reachable from a non-loopback interface.
