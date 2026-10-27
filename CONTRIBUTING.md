<!-- Created by The Angelo Umali. -->

# Contributing to ZKidz Studio

Thanks for helping. This page covers setup, branches, commits, tests and the rules every pull request must meet.

## Setup

```bash
git clone https://github.com/theangeloumali/zkidz-studio && cd zkidz-studio
./setup.sh            # Windows: setup.cmd
pnpm zks doctor       # checks node, pnpm, python, ffmpeg, GPU backends, models
                      # --render: test-encode every listed encoder; --bench: first start, warm ready time, idle RSS, encode fps
                      # --json: machine-readable; --bench --json is the redacted hardware report to paste in an issue
pnpm verify           # attribution check, lint, typecheck, tests
```

You do not need a GPU. Every feature has a CPU path, and CI runs on CPU.

## Branches

Branch from `develop` and open your pull request against `develop`. `main` only receives releases.

```bash
git switch develop && git pull
git switch -c feat/short-description
```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/). release-please builds the changelog and version from them.

```text
feat(engine): add Vulkan scale path
fix(server): reject UNC paths in media routes
docs: explain the WSL /mnt warning
```

## Attribution

Every new file that can hold a comment starts with `Created by The Angelo Umali.` in that file's comment syntax:

```ts
// Created by The Angelo Umali.
```

Use `#` for shell, Python, YAML, TOML and ignore files, `/* */` for CSS, `<!-- -->` for HTML and Markdown (line 1), `%%` for Mermaid
and `--` for SQL. JSON, lockfiles, licence texts and binaries are exempt. `node scripts/check-attribution.mjs` enforces this in CI.

## Tests

A pull request that changes behaviour ships tests for it: vitest for TypeScript, `unittest` for the Python engine. Write the failing
test first. Run prettier on every file you change. `pnpm verify` must pass before review.

## GPU verification hygiene

CI has no GPU runner, so the maintainer checks GPU paths by hand with `pnpm verify:gpu`. A PR that touches one gets the `gpu-needed`
label, which blocks merge until that check is ticked. To keep contributor code away from the maintainer's own accounts:

- `verify:gpu` runs only on a commit the maintainer has fully reviewed and pushed to a branch in the upstream repo, never on a fork
  checkout.
- It runs inside `docker/compose` with `--profile nvidia`, or under a separate OS user. Neither has `~/.claude`, `~/.ssh`, `gh` auth
  or network drive mounts.
- The script refuses to run when `$HOME/.claude` or `SSH_AUTH_SOCK` is visible.
- On a machine with no supported GPU it exits 0 and says why.

## What we do not accept

- Secrets, personal paths, hostnames or IPs in any file.
- Media, models, ffmpeg or Chrome binaries in git.
- Claude or Anthropic logos, or "Claude Code" as a product or feature name. See [TRADEMARKS.md](TRADEMARKS.md).

## Conduct and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in `SECURITY.md`.
