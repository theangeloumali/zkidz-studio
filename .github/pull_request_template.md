<!-- Created by The Angelo Umali. -->

## What and why

Closes #

## Checklist

- [ ] Branch targets `develop`, and the title follows Conventional Commits.
- [ ] Every new file starts with `Created by The Angelo Umali.` in its own comment syntax (JSON, lockfiles, LICENSE and binaries are exempt).
- [ ] Tests cover the change and `pnpm verify` passes.
- [ ] No secrets, personal paths, hostnames, IPs or media in the diff.
- [ ] No Claude or Anthropic logos, and "Claude Code" is not used as a product or feature name (see TRADEMARKS.md).

## GPU

- [ ] This change touches a GPU path. If so, add the `gpu-needed` label. The maintainer ticks the box below after running `pnpm verify:gpu` on a reviewed upstream branch.
- [ ] `pnpm verify:gpu` passed (maintainer only).
