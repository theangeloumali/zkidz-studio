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
2. `qc_master` with the same target (`full` or `reel`), then `job_wait` until it succeeds: its `result` is the report,
   every check with `ok` and a `detail`. A long edit's QC re-hears every cut and can run past an hour on CPU whisper;
   keep calling `job_wait`, never start a second QC (it returns the same job).
3. Fix each failing check at its cause, render again, run `qc_master` again. Never export a failed master.

## Checks and fixes

| Check             | Fails when                                                                                                                                                                                                                  | Fix                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`          | not a 1080×1920 or 2160×3840 portrait, not H.264/HEVC, rotation tag                                                                                                                                                         | engine problem: report it to the user                                                                                                      |
| `frames`          | frame count differs from the EDL (plus the brand intro)                                                                                                                                                                     | render again; report it if it repeats                                                                                                      |
| `loudness`        | outside −14 LUFS ±1 or true peak above −1 dBTP                                                                                                                                                                              | an SFX or bleep is too loud: lower it                                                                                                      |
| `motion`          | a shot's original moves but the master's picture is frozen                                                                                                                                                                  | hard stop: `check_motion` stage `source` tells ingest from render; tell the user which                                                     |
| `cutWords`        | a word clipped, missing or said twice at a cut (master re-heard; a flagged word is re-heard alone in the source, so transcript drift alone never fails it). Runs last, and reads "not run" when another gate already failed | move the removal edge into the pause (`check_window` shows the word's real timing), or `pin` it                                            |
| `captionContrast` | caption text below 4.5:1 against what is behind its plate                                                                                                                                                                   | move the caption with `bottom`, or ask the user about a plate; learning theme: reported, never blocks export (the v2 caption has no plate) |
| `hookMouth`       | something covers the speaker's mouth in the first 2.5 s                                                                                                                                                                     | move or shrink the hook's cue, or start it after 2.5 s                                                                                     |
| `lipSync`         | sound and picture disagree by half a frame or more after a cut                                                                                                                                                              | engine problem: render again once, report it if it repeats                                                                                 |
| `density`         | learning theme: more than 2 s between visuals in the hook, or 4 s in the body                                                                                                                                               | add a beat from the beat map where the gap is                                                                                              |
| `variety`         | learning theme: one technique over 30 % of the beats, or three in a row                                                                                                                                                     | swap the repeated beat for another technique from the `v2-vlog` menu                                                                       |
| `faceClear`       | learning theme: a graphic covers the presenter's face                                                                                                                                                                       | move the cue above the face box `frame_faces` reports                                                                                      |
| `faceWidth`       | learning theme: the face is wider than a quarter of the frame, so he is framed too close (reported, never blocks export)                                                                                                    | widen the `reframes` window (lower `scale`) or tell the user the footage is framed close; never cover the face                             |
| `textClear`       | learning theme: two cues' text shares space at the same moment (a kicker under a chip, a heading under a caption); `render_master` stops on it first                                                                        | move one cue into clear space or drop it (a big word's `kicker` and a `chipRail` both sit in the top band)                                 |
| `framed`          | learning theme, letterboxed source: a kept second shows the whole room (no reframe window, no full-frame cover)                                                                                                             | set the cut spec's `follow: "speaker"`, or add a `reframes` window over the listed times                                                   |
| `facesBlurred`    | learning theme, `blurFaces: "others"`: someone the user asked to blur can be recognised on the master                                                                                                                       | render again (the mask is redrawn from the footage); if it repeats, trim the listed seconds or tell the user which face the blur missed    |
| `map`             | learning theme: a place the footage proves (clip GPS) or the cut spec declares (`places`) has no `routeMap` pin within 25 km; no proof either way is a warning that passes                                                  | add a `routeMap` stop for each listed place where the video first arrives there; home is never pinned                                      |

## Common mistakes

- Claiming a master is ready on a partial pass. Quote every failing check and its detail to the user.
- Editing a spec with the edited times a `detail` names. Map them back to source seconds first.
- Waiting for a render to find frozen footage: `check_motion` with stage `source` runs right after `ingest`.

Hands to next: a master whose `qc_master` report passes every check → export (`export_deliverable`).
