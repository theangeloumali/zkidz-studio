---
name: qc-gates
description: Use when render_master has finished, before any export, or when qc_master or check_motion reports a failed check.
---

<!-- Created by The Angelo Umali. -->

# QC gates

A master is done when `qc_master` passes every check, not when it renders. Export stays blocked until the latest master
passes.

## The flow

1. `render_master` → `job_wait` until it succeeds. The render already fails when its frame count misses the EDL or its
   loudness misses −14 LUFS ±1 (true peak at or below −1 dBTP).
2. `qc_master` with the same target (`full` or `reel`). Every check comes back with `ok` and a `detail`.
3. Fix each failing check at its cause, render again, run `qc_master` again. Never export a failed master.

## Checks and fixes

| Check             | Fails when                                                                                                                                                 | Fix                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `format`          | not a 1080×1920 or 2160×3840 portrait, not H.264/HEVC, rotation tag                                                                                        | engine problem: report it to the user                                                           |
| `frames`          | frame count differs from the EDL (plus the brand intro)                                                                                                    | render again; report it if it repeats                                                           |
| `loudness`        | outside −14 LUFS ±1 or true peak above −1 dBTP                                                                                                             | an SFX or bleep is too loud: lower it                                                           |
| `motion`          | a shot's original moves but the master's picture is frozen                                                                                                 | hard stop: `check_motion` stage `source` tells ingest from render; tell the user which          |
| `cutWords`        | a word clipped, missing or said twice at a cut (master re-heard; a flagged word is re-heard alone in the source, so transcript drift alone never fails it) | move the removal edge into the pause (`check_window` shows the word's real timing), or `pin` it |
| `captionContrast` | caption text below 4.5:1 against what is behind its plate                                                                                                  | move the caption with `bottom`, or ask the user about a plate                                   |
| `hookMouth`       | something covers the speaker's mouth in the first 2.5 s                                                                                                    | move or shrink the hook's cue, or start it after 2.5 s                                          |
| `lipSync`         | sound and picture disagree by half a frame or more after a cut                                                                                             | engine problem: render again once, report it if it repeats                                      |

## Common mistakes

- Claiming a master is ready on a partial pass. Quote every failing check and its detail to the user.
- Editing a spec with the edited times a `detail` names. Map them back to source seconds first.
- Waiting for a render to find frozen footage: `check_motion` with stage `source` runs right after `ingest`.

Hands to next: a master whose `qc_master` report passes every check → export (`export_deliverable`).
