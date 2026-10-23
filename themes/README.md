<!-- Created by The Angelo Umali. -->

# Theme packs

A theme pack sets the look of every overlay the renderer draws: palette, type, hand-drawn boil, the brand intro, and which cue
kinds exist. `zkidz` is the default; `minimal` proves the contract with near-black on white, one accent, one sans face, no boil
and no intro.

The renderer loads a theme by id from this folder only (`node packages/engine/hf/render.js v1 --theme minimal`), never from a URL
or another path. A theme's look runs in Chrome and its words reach the agent, so a pack is reviewed like code.

## theme.json

| Field        | Meaning                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------- |
| `id`         | Lowercase letters, digits and `-`; the folder name                                                         |
| `tokens`     | Colour roles (`ink`, `paper`, `steel`, `gold`, ...) laid over the renderer's brand palette                 |
| `type`       | Six roles (`display`, `body`, `label`, `kicker`, `hand`, `mono`): family, size, weight                     |
| `boil`       | `true` keeps the hand-drawn wobble; `false` draws straight strokes                                         |
| `intro`      | `true` plays the brand intro after a `hookTitle` with `intro: true`                                        |
| `components` | The manifest: each cue kind the theme draws, with its `tier`, `purpose`, text `slots` and optional `tones` |

Families must be faces the renderer bundles (Newsreader, Inter, Caveat, JetBrains Mono); a theme that names another face is
refused when it loads.

## The component manifest

```json
"keyword": {
  "tier": "core",
  "purpose": "One spoken phrase pulled out as text, on footage, on paper or as a chip.",
  "slots": { "text": { "maxChars": 32 } },
  "tones": { "chip": { "text": { "maxChars": 27 } } }
}
```

- `tier` is `core` (most edits use it), `accent` (emphasis cards) or `special` (one-off layouts and depth effects).
- `purpose` is what the agent reads when it picks a kind; write it as the job the card does on screen.
- `slots` are a cue's top-level text fields (a string or a list of strings). `maxChars` is the longest text that slot takes;
  `add_cue` refuses longer. A tone's slots replace the base slots for cues in that tone.
- A build fails on any cue whose kind is not in the manifest, derived kinds (`censor`, `cutaway`) included.

The `maxChars` values come from the 1080-wide safe zone: the chip's 27 and the caption's 60 were measured on past edits, the
rest are conservative and get tightened as golden renders cover them.

## index.json

`zks-engine theme-index --json` writes `themes/<id>/index.json` for every pack: the manifest sorted by tier, which
`list_cue_kinds` filters by tier and purpose before the agent opens any component schema. The index is committed; a test fails
when it drifts from its `theme.json`, so re-run the command after editing a manifest.

## Making a theme

Copy `_blueprint/` to `themes/<your-id>/`, set `id` to the folder name, edit the tokens, type and manifest, then run
`zks-engine theme-index --json`. Folders starting with `_` are never loaded or indexed.
