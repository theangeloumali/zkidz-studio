---
name: reels
description: Use before set_reel, when choosing or changing the Reels cut, or when set_reel reports dropped cues.
---

<!-- Created by The Angelo Umali. -->

# Reels cut

The Reels cut is a shorter version of the same edit. It reuses the full edit's audio, cues and captions; you only choose
which source ranges it keeps.

## Choose the keeps

- Keeps are `{ at, end, pin? }` in source seconds, in source order, never overlapping. `set_reel` replaces the whole list.
- `pin: true` keeps both edges of a keep where you put them. Without it the engine snaps each edge up to 0.15 s to the
  quietest point, which can land inside a word. Pin an edge you placed with `check_window`.
- Open on the strongest hook in the video. It need not be the full edit's opening line.
- Each keep starts and ends between words: check the edges with `read_transcript` (`format: "words"`).
- Keep the story whole. A viewer who never sees the full edit should still follow it.
- A finished runtime under three minutes is one full master; do not make a second, near-identical cut.

## What follows the keeps

- `set_reel` returns `seconds` (the reel's length before pause trimming) and `droppedCues`: main-sheet cues the reel keeps
  less than half of. They do not show in the reel. If one matters, move the keep edge or add a reel-only cue with
  `add_cue` on the `reel` sheet.
- Captions follow the keeps: call `make_caption_phrases` with `reel: true` and then `set_captions` again. A caption group
  that crosses a keep edge fails, so regroup at the edge.

## Before you hand it on

Call `render_preview` on the reel at its first second and at each keep join. Ask the user to confirm the reel's opening
before covers.

Hands to next: a stored reel spec version → covers (the reel's cover in the intro format).
