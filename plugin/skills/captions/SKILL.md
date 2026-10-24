---
name: captions
description: Use before make_caption_phrases or set_captions, when a caption is wrong, untranslated, too long or crosses a Reels keep edge, or when a swear needs masking or a bleep.
---

<!-- Created by The Angelo Umali. -->

# Captions

Every spoken line of the edit gets an English caption in the bottom band. Timing never comes from you: it comes from the
phrase file, and you only decide how phrases group and what each group says in English.

## Order of work

1. Call `make_caption_phrases` after the cut spec is settled (and with `reel: true` once a reel exists). It returns
   phrases `{ id, at, end, reel, text }` in source seconds. `reel` is the index of the Reels keep holding the phrase, or
   null when the phrase is in the full edit only.
2. Group consecutive phrase ids into entries `{ ids, en }`. One entry is one caption on screen.
3. Call `set_captions` with every entry. It replaces the whole track.

## Rules `set_captions` enforces

- Every phrase is captioned exactly once, and the ids in an entry are consecutive.
- A group never mixes phrases with different `reel` values. A group that does would straddle a Reels keep edge; split it
  at the edge.
- The English fits two lines of the plate. About 60 characters or 10 to 12 words is the most that fits; split one long
  thought into two entries rather than squeezing it.

## Writing the English

- Translate every non-English line (Tagalog and Taglish included) into natural English. Keep names, product names and the
  speaker's tone; do not summarise.
- Captions are English on every line, even when the speaker is already speaking English.
- Mask swears in the text (`f***`, `s***`). The audio bleep is a separate step in the cut spec.
- Speech recognition often hears a product or person's name as a common word (an AI tool heard as "cloud" is the classic).
  Fix the word when the context makes the meaning clear.

## Bleeps

Place a bleep from the words of an isolated window around the swear (`check_window` on a range of a few seconds), never from
long-form transcript times, which drift by about half a second. Then add it to the cut spec's `bleeps` with `set_cuts`.

## Placement

The plate sits in the bottom band. It must stay below the speaker's mouth and chin for the whole line, punch-ins and two-line
captions included. Check with `render_preview` at a few caption times and report anything that covers the face.

Hands to next: a stored captions version → `reels` (the Reels keeps) and the caption cues the preview and render draw.
