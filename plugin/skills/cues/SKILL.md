---
name: cues
description: Use before list_cue_kinds, add_cue, update_cue or remove_cue, and when a cue fails its anchor or width check, overlaps another card, or the screen feels crowded.
---

<!-- Created by The Angelo Umali. -->

# Cues

A cue is one graphic on screen: a hook title, a keyword, a lower third, a list card. Cues serve the story. A cue that only
decorates gets cut.

## Pick the kind

- Call `list_cue_kinds` with a `tier` and a few `purpose` words before opening any schema. `core` kinds carry most edits;
  `accent` kinds add emphasis; `special` kinds are for one moment in a video, not a pattern.
- Each listed kind has its JSON Schema, `maxChars` per text slot and per-tone caps in `tones` (a keyword's `chip` tone fits
  27 characters). Stay under the cap; `add_cue` fails past it.
- Captions, censor gags and cutaways are written by other steps (`set_captions`, the cut spec). Do not add them here.

## Land it on the word

- Times are source seconds. Every cue carries `anchor: { phrase, wordIndex }`: the transcript word it lands on, and the
  phrase as heard from that word on. Read the words with `read_transcript` (`format: "words"`) to get the index.
- `at` must sit between 0.2 s before and 1.8 s after that word's start. `add_cue` and `update_cue` fail outside that window,
  and when the phrase no longer matches the transcript.
- Word pins inside a cue (a row's `at`, `subAt`, `swapAt`) are seconds after the cue's own `at`, so they stay on their word.

## Sheets, ids and edits

- `sheet` is `main` (the full edit), `reel` (cues only the Reels cut shows) or `cover` (the cover still).
- `add_cue` returns the cue's `id`. Use it for `update_cue` (a patch; a null removes a field) and `remove_cue`.
- Read the `warnings`: an overlap means two cards share the screen. Move one, or remove one.

## Density

- One idea on screen at a time. Leave at least a second of clean footage between cards.
- The first three seconds carry the hook title and nothing that competes with it.
- Fewer, stronger cues beat many small ones. If two cues say the same thing, keep the better one.

## Check it

Call `render_preview` at a few cue times with `guides: true`. Cards belong in the top band and clear of the platform's
right-hand column; fix anything outside the guides.

Hands to next: a stored cue sheet version → `captions`, then `reels` for the Reels cut.
