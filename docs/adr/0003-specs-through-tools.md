<!-- Created by The Angelo Umali. -->

# ADR 0003: The agent edits specs only through typed MCP tools

- Status: Accepted
- Date: 2026-10-22
- Plan: D4, §6.8, §7.7

## Context

In zkidz-films the agent wrote `cues/vN.js`, executable JavaScript loaded into a shared global scope, and edited JSON files directly.
That allowed arbitrary code from agent output and produced crash classes such as the reel-override splice and the `pipeline` cue
with the wrong shape failing deep into an encode.

## Decision

- No `Edit`, `Write` or `Bash` tool in v1. Every spec change goes through an `mcp__studio__*` tool whose zod input lives in
  `@zks/shared` (`STUDIO_TOOLS`).
- Specs are JSON: `CutSpec` objects instead of positional arrays, cue sheets as a discriminated union on `kind`, Reels overrides as
  a patch list matched by `{kind, at}`.
- Specs reference media by `assetId` only. Strict objects reject unknown keys, so a `source: "/etc/passwd"` field fails validation.
- `packages/shared/schema/*.json` is generated from zod (`pnpm -F @zks/shared schema:export`) for the Python engine; a test fails
  when the committed files drift.

## Consequences

- One write path gives one validation, one `spec.version` event and one version row per change.
- A contract change after Wave 0 is a tech-lead decision on its own commit.
