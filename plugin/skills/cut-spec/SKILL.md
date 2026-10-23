---
name: cut-spec
description: Use before every set_cuts call. How a cut spec is built - removals, pause trimming, bleeps, blur boxes, zooms and cutaways - in source seconds, with media named by assetId only.
---

<!-- Created by The Angelo Umali. -->

# Cut spec

A cut spec describes the full edit as changes to one joined source. `set_cuts` replaces the whole spec, so always send every
field you want to keep.

## Shape

- `schemaVersion: 1`, `sourceAssetId` (the joined source from `ingest`), `durationS`, and `fps` as a rational
  (`{ num: 30000, den: 1001 }`, never `29.97`: frame identity depends on it).
- `removals`: spans `{ at, end, reason }` in source seconds, `end` after `at`. Media is named by `assetId` only; a spec with a
  path in it is rejected.
- A removal that comes from `propose_cuts` carries `fromCandidate` with the candidate id. Only ids the user approved pass;
  never reuse a rejected one.
- `pin: true` keeps a removal exactly where you put it. Without it the engine snaps each edge up to 0.15 s to the quietest
  point nearby, which is almost always what you want.

## Pauses

- Prefer `trimPauses` over hand-written pause removals: `{ thresholdDb, minS, keepS, exclude }`. A start point is
  `thresholdDb: -35`, `minS: 0.6`, `keepS: 0.15`.
- Put deliberate beats (after a punchline, before a reveal) in `exclude`.
- `set_cuts` reports `keptS` before pause trimming; the rendered edit will be a little shorter.

## Other fields

- `bleeps`: swears to mask, `{ at, end, x, y }`. Place them from the words of an isolated window around the swear, not from
  long-form transcript times, which drift by about half a second.
- `blurBoxes`: on the 1080×1920 grid, inside the frame. Blur other people's private details (their faces in photos, names,
  addresses, phone numbers, emails). Do not blur the creator's own family or home unless the user asks, and then exactly
  as asked.
- `zooms`: a preset (`snap`, `push`, `reveal`, `through-out`, `through-in`, `portal`) over a span. Jump cuts already get an
  alternating punch-in; add zooms for emphasis only.
- `cutaways`: a title card `{ title, sub?, style? }` over a span, for a chapter change.
- `faceCamRanges` and `matteRanges`: spans where the speaker's face is the subject.

## Before you call set_cuts

- Every span sits inside `0 … durationS`, and removals do not cut a word in half (check `read_transcript` with
  `format: "words"` around each edge).
- The opening line is the hook you agreed with the user.
- Then call `validate_spec` and fix whatever it reports.

Hands to next: a stored `CutSpec` version → cue sheet and captions (later skills).
