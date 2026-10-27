<!-- Created by The Angelo Umali. -->

# Contributing to ZKidz Studio

For developers sending a pull request. Covers setup, the local CI gate, tests, attribution and worktrees. Last reviewed
2026-10-27.

## Setup

```bash
git clone https://github.com/theangeloumali/zkidz-studio && cd zkidz-studio
./setup.sh --no-start   # Windows: setup.cmd --no-start
pnpm zks doctor         # node, pnpm, uv, python, ffmpeg, GPU backend, whisper, Chrome, models, port
                        # --render: test-encode every listed encoder; --bench: first start, warm ready time, idle RSS, encode fps
                        # --json: machine-readable; --bench --json is the redacted hardware report to paste in an issue
pnpm dev                # web and server in watch mode
```

You do not need a GPU. Every feature has a CPU path. Run everything through `pnpm` (`pnpm <script>`, `pnpm exec`, `pnpm dlx`),
never a bare `node` or `npx`: only package scripts get the pinned Node.

## The gate: `pnpm ci:local`

The GitHub workflows are manual-only (`workflow_dispatch`). CI runs on your machine, and `pnpm ci:local` must pass before a pull
request is reviewed or merged.

```bash
pnpm ci:local --list      # the steps it runs
pnpm ci:local             # run them; exit 1 if any step failed
pnpm ci:local --release   # adds a fresh setup.sh and the doctor (develop -> main)
```

It runs `actionlint`, `gitleaks` and the install in turn, then `engine`, `lint`, `test-server`, `typecheck`, `test-other` and
`format` side by side. Every step runs even after one fails. `ZKS_CI_JOBS` caps the workers per test lane (default 6;
vitest uses at most 4 of them). `ZKS_CI_LANES` sets the lane count, which otherwise is every lane at once, or 2 on a machine
busier than its cores or a checkout under WSL's `/mnt`. It is Linux x64 only, because the pinned scanners are Linux builds; on Windows use WSL.

`pnpm verify` is the quicker inner loop: attribution, prettier, lint, typecheck and tests.

## Tests first

A change in behaviour ships with tests: vitest for TypeScript, `unittest` for the Python engine. Write the failing test first,
watch it fail, then make it pass. Bug fixes start with a test that reproduces the bug.

```bash
pnpm -F @zks/server test
uv run --project packages/engine python -m unittest discover -s packages/engine/tests
```

Run prettier on every file you change (`pnpm exec prettier --write <file>`).

## Attribution header

Every new file that can hold a comment starts with this line in its own comment syntax:

```ts
// Created by The Angelo Umali.
```

Use `#` for shell, Python, YAML, TOML and ignore files, `/* */` for CSS, `<!-- -->` for HTML and Markdown (line 1), `%%` for Mermaid,
`--` for SQL and `REM` for `.cmd`. JSON, lockfiles, licence texts and binaries are exempt. `node scripts/check-attribution.mjs`
enforces it.

## Branches and commits

Branch from `develop` and open your pull request against `develop`; `main` only receives releases. Use
[Conventional Commits](https://www.conventionalcommits.org/) (`feat(engine): add Vulkan scale path`). release-please builds the
changelog and version from them.

## Worktrees

Parallel work goes in git worktrees inside the checkout, under `.claude/.worktree/<name>`, never beside the repo. The folder is
git-ignored.

```bash
git worktree add .claude/.worktree/my-feature -b feat/my-feature develop
cd .claude/.worktree/my-feature && pnpm install --frozen-lockfile
```

Each worktree needs its own `pnpm install`. Remove it when the branch merges: `git worktree remove .claude/.worktree/my-feature`.

## GPU verification hygiene

There is no GPU runner, so the maintainer checks GPU paths by hand with `pnpm verify:gpu`. A pull request that touches one gets
the `gpu-needed` label, which blocks merge until that box is ticked. To keep contributor code away from the maintainer's accounts:

- `verify:gpu` runs only on a commit the maintainer has reviewed and pushed to a branch in the upstream repo, never on a fork
  checkout.
- It runs inside `docker/compose` with `--profile nvidia`, or under a separate OS user. Neither has `~/.claude`, `~/.ssh`, `gh`
  auth or network drive mounts.
- The script refuses to run when `$HOME/.claude` or `SSH_AUTH_SOCK` is visible.
- On a machine with no supported GPU it exits 0 and says why.

## Public repo rules

```bash
pnpm zks scrub-check <path>...   # fails on personal paths, hostnames, IPs, client names
```

- No secrets, personal paths, hostnames, IPs or client names in any file.
- No media, models, ffmpeg or Chrome binaries in git.
- No Claude or Anthropic logos, and no "Claude Code" as a product or feature name. See [TRADEMARKS.md](TRADEMARKS.md).

## Conduct and security

Follow the [Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as described in [SECURITY.md](SECURITY.md).
