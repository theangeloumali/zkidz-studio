<!-- Created by The Angelo Umali. -->

# ADR 0005: Apache-2.0 licence and naming

- Status: Accepted
- Date: 2026-10-22
- Plan: D9, D11, §6.4

## Context

The repo is public and people download it from GitHub. Contributors need a licence with an explicit patent grant. The product
talks to Claude but is not an Anthropic product.

## Decision

- Licence: Apache-2.0. Third-party notices live in `THIRD_PARTY.md`.
- Product name: "ZKidz Studio". The UI names Claude only in plain text ("Use Claude Code in a terminal"); no Claude
  logos, no Claude Code mascot, and no "Claude Code" in a product or feature name.
- Every source file that can hold a comment starts with `Created by The Angelo Umali.` in its own comment syntax.
  `scripts/check-attribution.mjs` enforces it in `pnpm verify` and CI; JSON, lockfiles, licence texts and binaries are exempt.

## Consequences

- An agent-written file without the line fails verification before it can merge.
