<!-- Created by The Angelo Umali. -->

# Local Supabase port evidence (plan §14 Phase 7 AC)

The AC: on Linux, Docker Desktop for Windows and Docker Desktop for macOS, `docker ps --format '{{.Ports}}'` shows only `127.0.0.1:`
publishings and only 45322 by default (the Studio profile adds only `studio-proxy` on 45323; Studio itself publishes nothing), and Postgres
answers on no non-loopback interface. GitHub's Windows and macOS runners cannot run
Linux containers, so those two rows are captured by hand. Addresses and hostnames are left out on purpose; the count is enough.

To capture a row:

```bash
pnpm db:supabase:start > /dev/null    # stdout carries the DATABASE_URL and its password
docker ps --filter label=com.docker.compose.project=zks-studio-supabase --format '{{.Ports}}'
pnpm db:supabase:check                # exits 1 on a non-loopback or unexpected publishing, an answer off loopback, or a Windows reservation
pnpm db:supabase:stop
```

| Runtime                                                                            | Date       | `docker ps` Ports (default)            | `db:supabase:check`                                                                      | Status                  |
| ---------------------------------------------------------------------------------- | ---------- | -------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------- |
| Linux, Docker Engine (ubuntu-24.04 CI)                                             | every run  | asserted by `.github/workflows/db.yml` | run by the same workflow                                                                 | automated               |
| Docker Desktop 4.96.1 on Windows 11, WSL2                                          | 2026-10-23 | `127.0.0.1:45322->5432/tcp`            | exit 0; 4 non-loopback addresses probed, none answered; no reservation on 45322 or 45323 | passed                  |
| Linux shell (WSL2 Ubuntu, kernel 6.18.33.2) → Docker Desktop 4.96.1, Engine 29.9.2 | 2026-10-24 | `127.0.0.1:45322->5432/tcp`            | exit 0; port 45322 off loopback: no answer; no reservation on 45322 or 45323             | passed                  |
| Docker Desktop on macOS                                                            | none       | not captured                           | not captured                                                                             | not run — needs that OS |

On the Windows run, `ss -ltn` showed the listeners on `127.0.0.1` only. WSL used mirrored networking, so the probed addresses were the
Windows host's own.

Studio has no login, so it publishes nothing. `studio-proxy` (Caddy) is the only publishing on 45323. It answers 421 to any Host other than
`127.0.0.1:45323` / `localhost:45323` (DNS rebinding), and 401 without the basic-auth user `zks` and the `STUDIO_PASSWORD` in
`ZKS_HOME/db/supabase.env`. Captured on Docker Desktop 4.96.1 / WSL2, 2026-10-23, with `pnpm db:supabase:studio`:

| Check                                                  | Result                                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `curl -H 'Host: evil.example' http://127.0.0.1:45323/` | 421                                                                                                           |
| correct Host, no credentials                           | 401                                                                                                           |
| correct Host, `-u zks:<STUDIO_PASSWORD>`               | 307 to `/project/default`, which answers 200                                                                  |
| `docker ps` Ports                                      | `studio-proxy 127.0.0.1:45323->45323/tcp`, `studio 3000/tcp`, `meta 8080/tcp`, `db 127.0.0.1:45322->5432/tcp` |

## Linux run, 2026-10-24

Run from a WSL2 Ubuntu shell against Docker Desktop 4.96.1 (Engine 29.9.2), with a scratch `ZKS_HOME` and
`ZKS_SUPABASE_PROJECT=zks-p7-evidence`, so no real data was used. A native Linux Docker Engine is covered by the CI row only.

| Check                                                                                       | Result                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm db:test:matrix`                                                                       | pglite: 13 files, 101 tests passed; postgres: 13 files, 101 tests passed (up, down, up included); exit 0                                              |
| `docker ps --filter label=com.docker.compose.project=zks-p7-evidence --format '{{.Ports}}'` | `127.0.0.1:45322->5432/tcp`                                                                                                                           |
| `ss -ltn`                                                                                   | listener on `127.0.0.1:45322` only                                                                                                                    |
| `pnpm db:supabase:studio`, `docker ps` Ports                                                | `studio-proxy 127.0.0.1:45323->45323/tcp`, `studio 3000/tcp`, `meta 8080/tcp`, `db 127.0.0.1:45322->5432/tcp`                                         |
| Studio proxy: no credentials / `Host: evil.example`                                         | 401 / 421                                                                                                                                             |
| `export DATABASE_URL=$(pnpm --silent db:supabase:url) && pnpm start`                        | log `"backend":"postgres"` on `127.0.0.1:4317`                                                                                                        |
| `POST /api/projects` (same-origin, `x-zks-csrf`, JSON)                                      | 201; `GET /api/projects` lists it; the row is in `studio.projects`; `drizzle.__drizzle_migrations` has 1 row                                          |
| `db:backup`, `db:restore`, `db:rollback -- --to 0000`, `db:supabase:stop`                   | all exit 0; restore brought the deleted project back                                                                                                  |
| `docker compose -f docker/compose.yml up -d --build`                                        | healthy; `zkidz-studio-studio-1 127.0.0.1:4317->4317/tcp`, the only 4317 publishing                                                                   |
| `docker compose -f docker/compose.yml --profile nvidia up -d --build studio-nvidia`         | healthy on `127.0.0.1:4317->4317/tcp`; doctor gpu check: pass, `nvidia (hevc_nvenc)`                                                                  |
| `docker compose -f docker/compose.yml down`, then `up -d --build`                           | both exit 0; back on `127.0.0.1:4317->4317/tcp`; the doctor's Node.js check reads `node` / `Node.js` (fixed in c9c211a; the container user is `node`) |
| `docker compose -f docker/compose.yml down -v`                                              | exit 0; container, network and `zkidz-studio_zks-home` removed                                                                                        |

`pnpm db:reset` was not run here: the machine's destructive-command guard blocks it, and it was not bypassed.

## Cross-OS setup, 2026-10-27

`setup-e2e.yml` on bare GitHub runners: the README's single setup command, then `127.0.0.1:4317` must answer. Ubuntu 24.04 and
macOS 15 passed on the first run (40475933705). Windows (windows-2025) failed there because `setup.cmd`, started from
PowerShell 7, gave Windows PowerShell pwsh's module path; with that fixed, all three passed (40478846077), Windows answering
after about 90 s.
