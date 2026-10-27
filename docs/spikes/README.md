<!-- Created by The Angelo Umali. -->

# Phase 0 spikes (plan §14, row 0c)

Run on Linux (WSL2, Docker Engine, RTX GPU) with Claude Code 2.1.308 and Agent SDK 0.3.308, signed in with a
subscription. Each folder has its own README with the exact commands, the output and the decision.

| #   | Spike                                                                  | Status                                      | Decision for the plan                                                                                                                    |
| --- | ---------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | [SDK init assertion](01-sdk-init/README.md)                            | PASS (login); NOT-RUNNABLE (live mode A/B)  | Exempt `@builtin` plugins; assert required skills are included; isolate `CLAUDE_CONFIG_DIR` in modes A/B; add a mode B startup timeout.  |
| 2   | [Glob / Grep](02-glob-grep/README.md)                                  | PASS (Linux); NOT-RUNNABLE (macOS, Windows) | Enable only with the PreToolUse confinement hook; unconfined, they read outside the project.                                             |
| 3   | [Supabase Postgres-only + drizzle on PGlite](03-db-backends/README.md) | PASS (drizzle); FAIL (ports, loopback)      | One migration set works; pin PG major (PGlite is 18, Supabase 17); ports below 49152; Postgres binds 0.0.0.0, so fix the binding.        |
| 4   | [Pinned BtbN ffmpeg](04-ffmpeg-pin/README.md)                          | FAIL (whisper); PASS (pin, GPU)             | `--disable-whisper` confirms D6 (whisper.cpp); pin month-end tags only.                                                                  |
| 5   | [`-p` setting sources](05-print-setting-sources/README.md)             | PASS                                        | `--restricted --strict-mcp-config` + `ENABLE_CLAUDEAI_MCP_SERVERS=false`; connectors otherwise attach at random.                         |
| 6   | [devEngines download](06-devengines-download/README.md)                | PASS                                        | Keep `onFail: "download"`; only scripts use the pinned Node, so route commands through `pnpm run`.                                       |
| 7   | [Terminal mode under node-pty](07-terminal-mode/README.md)             | PASS (Linux); NOT-RUNNABLE (ConPTY, macOS)  | SessionStart needs a `command` relay hook (no `http`); trust dialog defaults to "No, exit"; detect onboarding by a missing SessionStart. |

Spike code is not part of the app: each folder pins its own dependencies, and `node_modules/` is gitignored.
