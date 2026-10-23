<!-- Created by The Angelo Umali. -->

# Learnings from past edits

Each entry is a trap a real edit hit and the rule that avoids it. The engine already enforces the mechanical ones (frame
identity, chunked renders, loudness); these are the ones that need judgement.

## Cutting

- **Transcript word times drift.** On mixed-language speech, word starts were off by up to half a second (one camera's HDR
  files: a full second). Place every hand cut, bleep and caption start from `check_window` on a short window around the word
  and from `energy_profile`, never from long-form word times alone.
- **A cut can snap into a word.** An unpinned edge snaps to the quietest point nearby, and once that was the gap between an
  "s" and its vowel, leaving a stray hiss. Pin an edge only after checking it with `check_window`; let the others snap.
- **The cut spec only removes, in order.** It cannot move a later moment to the front. A cold open from later in the clip
  needs the source rebuilt with that moment ingested first, and every later source time shifts by its length.
- **A silent clip is a different edit.** A clip with no real audio (a timelapse) must not be loudness-normalised: that lifts
  the noise floor by tens of decibels. Ask the user what plays under it.

## Captions and cards

- **Captions sit low but clear of the mouth.** Start new caption plates at `bottom: 1750` and check every lean-in and
  punch-in: one lean-in put the speaker's lips at y 1630, so that cue alone went lower.
- **A card or caption that straddles a reel cut can vanish.** A reel keeps a cue only when most of its span survives. Keep
  caption groups and reel-only cues inside one kept segment.
- **Translation must not add facts.** Some languages do not mark gender ("my kid", not "my son"); write English that says
  exactly what the speech says.
- **Transcripts mishear product names.** A brand or tool name heard as a common word ("cloud" for an AI product's name) is
  checked against the context before it goes into a caption.

## Privacy

- **Blur is for other people.** Blur other people's faces in photos, client and third-party names, and the creator's own
  email, phone and address. Do not blur the creator's own family or home unless they ask, and then exactly as asked.
- **Scan where the camera moves.** A handheld opening hid a person in the background that sparse full-frame checks missed;
  check the first kept seconds densely, in quarter-frame crops, and follow moving screens and shelves frame by frame.
- **Screens scroll.** A blur box placed from one sample a second missed text that scrolled under it. Check a screen's whole
  span, not one frame of it.

## Process

- **Never render while specs can still change.** A render started while the cue sheet was still being written shipped
  half an edit. Finish every spec write, then render.
- **A frozen picture passes every count.** Frame counts, audio length and changing overlays all looked right on a master
  whose footage had stopped moving. `check_motion` compares real movement against the source; run it on every master.
