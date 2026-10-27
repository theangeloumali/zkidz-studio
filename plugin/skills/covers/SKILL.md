---
name: covers
description: Use when making cover stills or thumbnails for an edit or its Reels cut, before calling make_covers, or when a cover shows something private.
---

<!-- Created by The Angelo Umali. -->

# Covers

A cover is the still people see before they press play. It uses the same look as the edit's opening, so the first frame
and the thumbnail promise the same thing.

## The format, always

- Every cover is a settled `hookTitle` (kicker tab, a white line over a gold line, the gold rule) plus the caption on that
  frame. Never a separate cover-only title style.
- Pick a time where the title has finished animating in and the speaker's face is clear: eyes open, not mid-blink or
  mid-word. A hook title lands about 1.4 s after its cue starts; `make_covers` refuses an earlier time and names the first
  time that works.

## Which covers

| Cover | Variant                          | Time (edited seconds)                                   |
| ----- | -------------------------------- | ------------------------------------------------------- |
| A     | `source: "intro"`                | about 2.3 s: the edit's own hook, just before the intro |
| B     | `source: "free"`, optional `cue` | any strong frame later in the edit                      |

- Give cover B a `cue` (a `hookTitle` with its own short line) when the moment needs words of its own.
- The Reels covers (`reels-cover-A/B`) are a second call with `target: "reel"`, at times on the Reels cut's own timeline.

## Post caption

- Pass `postCaption` (the post's caption and hashtags, at most 2,200 characters) on either call. It becomes the edit's
  `caption.txt`; the full edit and its Reels cut share one.

## Blur

- Stills are drawn without the master's blur pass, so `make_covers` applies every cut-spec blur box live at the cover's
  frame. A stranger's photo, a client's name or a phone number is blurred on the cover too.
- Something private visible with no box over it: add the box with `set_cuts`, then make the covers again. Never pick a
  different frame just to dodge a box.

## Common mistakes

- Source seconds instead of edited seconds for `at`.
- A cover mid-animation, with the title half drawn.
- Calling the covers done without looking at each returned still at phone size.

Hands to next: cover stills A and B and the Reels covers, blur applied, plus caption.txt → `qc-gates` (qc_master on the master, then export).
