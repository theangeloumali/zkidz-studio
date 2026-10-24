<!-- Created by The Angelo Umali. -->

# Troubleshooting with `zks doctor`

For anyone whose setup, render or Claude connection is not working. Last reviewed 2026-10-24.

```bash
pnpm zks doctor           # human-readable table
pnpm zks doctor --json    # the same checks as JSON, safe to paste into a bug report
pnpm zks doctor --fetch   # re-runs setup's downloads first, then checks
```

Sample output:

```text
ok   node         v26.12.1
ok   ffmpeg       ffmpeg version n8.1.3 ...
ok   gpu          nvidia (hevc_nvenc)
ok   chrome       chrome-headless-shell 155.0.8059.39 rendered a page
ok   models       tiny, base, tiny.en
ok   claude       2.1.310 (Claude Code)
ok   node-pty     loads (terminal mode available)
ok   port         4317 free
WARN wsl          repo or ZKS_HOME is under /mnt
     fix: clone into ~ and keep ZKS_HOME there: /mnt is several times slower
```

The doctor exits 1 only when a required check fails. `--json` output masks API keys, auth headers and email addresses.

## What each check means

| Check                          | What it proves                                     | If it fails                                                      |
| ------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------- |
| `node`, `pnpm`, `uv`, `python` | The pinned toolchain runs                          | Re-run `./setup.sh` (Windows: `setup.cmd`)                       |
| `ffmpeg`                       | The pinned ffmpeg is present and runs              | `pnpm zks doctor --fetch`                                        |
| `gpu`                          | Which backend encoded real test frames             | Never a failure; `cpu` works everywhere, more slowly             |
| `whisper-cpp`                  | The transcriber runs                               | `pnpm zks doctor --fetch`                                        |
| `chrome`                       | Headless Chrome rendered a page (titles, captions) | `pnpm zks doctor --fetch`                                        |
| `models`                       | Which whisper models are installed                 | `pnpm zks models fetch <name>`; list them with `pnpm zks models` |
| `claude`                       | Claude Code's version, for mode T only (2.1.295+)  | Only matters for mode T; modes A and B do not need it            |
| `node-pty`                     | The terminal pane can load (mode T)                | On Linux, install a C++ toolchain and re-run setup               |
| `disk`                         | Free space                                         | Warns below 20 GB                                                |
| `port`                         | Port 4317 is free                                  | Stop whatever holds it, or set `ZKS_PORT`                        |
| `wsl`                          | The repo and `ZKS_HOME` are off `/mnt`             | Clone into your Linux home; `/mnt` is several times slower       |

Larger models download on first use. To fetch one now:

```bash
pnpm zks models fetch large-v3-turbo-q5_0
```

## Common problems

- **The Connect Claude key is rejected.** Check the key in the Claude Console and paste it again. "Out of credit" means the
  Console account needs credit.
- **Mode B never starts.** The card times out after 30 seconds; sign in with your cloud provider's CLI and try again.
- **Mode T says Claude Code is missing.** Install it, or update to 2.1.295 or newer, then reload Setup.
- **Renders are very slow.** `gpu` shows `cpu`, so there is no hardware encoder. Use **Render 1080p instead**.
- **The app will not open from another device.** That is deliberate: the server answers on `127.0.0.1` only.
