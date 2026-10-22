<!-- Created by The Angelo Umali. -->

# Spike 2: Glob and Grep availability

**Status: PASS** on Linux/WSL: both tools run under the SDK, and a PreToolUse hook confines them to the project.
**NOT-RUNNABLE** here: macOS and native Windows.

## Goal

Can jobs be given Glob and Grep in addition to Read? Do they work without ripgrep on PATH, and can a hook keep them inside
the project directory?

## Commands

```bash
cd docs/spikes/02-glob-grep      # reuses ../01-sdk-init (install it first)
node probe.mjs Grep              # no hook
node probe.mjs Glob
node probe.mjs Grep confined     # PreToolUse hook (matcher "Glob|Grep") denies paths outside fixture/project
node probe.mjs Glob confined
```

The fixture has `ZKS_SPIKE_MARKER` both in `fixture/project/sub/notes.txt` and in `fixture/outside/secret.txt`. The
prompt asks the model to search `..`. The `confineSearch` hook resolves `realpath` and compares on a path-separator
boundary.

## Output excerpts

```text
Grep, no hook:   init.tools [Glob, Grep, Read]
                 "<fixture>/outside/secret.txt:1:ZKS_SPIKE_MARKER outside project
                  sub/notes.txt:2:ZKS_SPIKE_MARKER inside project"
Glob, no hook:   "sub/notes.txt\n<fixture>/outside/secret.txt"
Grep, confined:  is_error true  "PreToolUse:Grep hook error: path outside the project"
Glob, confined:  is_error true  "PreToolUse:Glob hook error: path outside the project"
```

Both tools use the ripgrep bundled with the SDK; no `rg` is on PATH. The `Reached maximum number of turns (1)` result is
expected, because the probe stops after the tool call.

## Decision for the plan

Glob and Grep may join the job tool list **only together with the confinement PreToolUse hook**: without it they read
outside the project in one call. The hook has to resolve symlinks and match on a separator boundary, the same rule as
the Read policy. Re-run this spike on macOS and Windows before enabling them on those platforms.
