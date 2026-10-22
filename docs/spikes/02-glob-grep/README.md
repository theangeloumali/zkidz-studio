<!-- Created by The Angelo Umali. -->

# Spike 2: Glob and Grep availability

**Status: PASS** on Linux/WSL: both tools run under the SDK, and a PreToolUse hook confines them to the project once it
checks every path-bearing field (round 2; round 1 checked only `path` and leaked through an absolute Glob pattern).
**NOT-RUNNABLE** here: macOS and native Windows.

## Goal

Can jobs be given Glob and Grep in addition to Read? Do they work without ripgrep on PATH, and can a hook keep them inside
the project directory?

## Commands

```bash
cd docs/spikes/02-glob-grep          # reuses ../01-sdk-init (install it first)
node --test confine.test.mjs         # the confinement rule, no model call
node probe.mjs <scenario>            # no hook
node probe.mjs <scenario> confined   # PreToolUse hook (matcher "Glob|Grep") runs confine.mjs
```

Scenarios: `Grep` and `Glob` search `..` through `path`. `Glob-dotdot-pattern` (pattern `../outside/*.txt`),
`Glob-absolute-pattern` (absolute pattern, path `.`) and `Grep-dotdot-glob` (glob `../outside/*.txt`) try to escape through
the pattern instead.

The fixture has `ZKS_SPIKE_MARKER` both in `fixture/project/sub/notes.txt` and in `fixture/outside/secret.txt`.
`confine.mjs` denies a call when `path` does not resolve (`realpath`) inside the project on a separator boundary, or is a UNC
or device path; or when Glob's `pattern` or Grep's `glob` contains `..`, or any brace alternative starts with `/`, `\`, `~`
or a drive letter. Grep's `pattern` is a regex and is not checked.

## Output excerpts

```text
Grep, no hook:   init.tools [Glob, Grep, Read]
                 "<fixture>/outside/secret.txt:1:ZKS_SPIKE_MARKER outside project
                  sub/notes.txt:2:ZKS_SPIKE_MARKER inside project"
Glob, no hook:   "sub/notes.txt\n<fixture>/outside/secret.txt"
Grep, confined:  is_error true  "PreToolUse:Grep hook error: path outside the project"
Glob, confined:  is_error true  "PreToolUse:Glob hook error: path outside the project"

Glob-absolute-pattern, no hook:           "<fixture>/outside/secret.txt"
Glob-absolute-pattern, round-1 path hook: "<fixture>/outside/secret.txt"   (leak: path "." passed the check)
Glob-absolute-pattern, confined:          is_error true  "pattern escapes the project"
Glob-dotdot-pattern, no hook:             "No files found"
Glob-dotdot-pattern, confined:            is_error true  "pattern escapes the project"
Grep-dotdot-glob, no hook:                "No matches found"
Grep-dotdot-glob, confined:               is_error true  "glob escapes the project"
```

The `..` patterns found nothing without the hook on this SDK build, but that is ripgrep's current behaviour, not a guarantee,
so the hook denies them anyway.

Both tools use the ripgrep bundled with the SDK; no `rg` is on PATH. The `Reached maximum number of turns (1)` result is
expected, because the probe stops after the tool call.

## Decision for the plan

Glob and Grep may join the job tool list **only together with the confinement PreToolUse hook**: without it they read
outside the project in one call. Checking `path` alone is not enough: an absolute Glob pattern with `path: "."` read outside
the project past the round-1 hook. The hook must check every path-bearing field: resolve `path` through symlinks and match
on a separator boundary (the Read rule), and reject `..` segments, absolute, home, drive and UNC/device prefixes in Glob
`pattern` and Grep `glob`, including inside brace alternatives. The §6.10 helper applies this same rule to every
path-bearing field of every tool it covers. Re-run this spike on macOS and Windows before enabling them on those platforms.
