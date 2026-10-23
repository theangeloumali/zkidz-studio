<!-- Created by The Angelo Umali. -->

# Card tiers in the zkidz theme

`list_cue_kinds` returns each kind with its schema and `maxChars`, not its tier. This table is the tier of every kind in the
zkidz theme manifest (`themes/zkidz/index.json`); a test keeps the two in step.

## `core`

Every preset that draws cards allows these.

| Kind          | Purpose                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| `caption`     | The spoken words as a subtitle plate in the bottom band.                                                   |
| `censor`      | Covers a bleeped word on screen; derived from the cut spec's bleeps.                                       |
| `chapterCard` | Marks a new section of the story with an index and a title.                                                |
| `cutaway`     | A wipe or title card over removed footage; derived from the cut spec.                                      |
| `endCard`     | The closing call to action and sign-off.                                                                   |
| `hookTitle`   | The opening promise: a kicker tab over one to three short lines, one in the accent. Also the cover format. |
| `keyword`     | One spoken phrase pulled out as text, on footage, on paper or as a chip.                                   |
| `lowerThird`  | Names a speaker or place the first time they appear.                                                       |

## `accent`

Allowed by `zkidz` and `loud`.

| Kind           | Purpose                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `checklist`    | Rows ticked or crossed as they are said.                                    |
| `chips`        | Named items (tools, things) as chips, one hot.                              |
| `comment`      | A viewer comment quoted as a card, to answer it on camera.                  |
| `criteriaCard` | A titled card of rules or criteria, one row per beat.                       |
| `flowRow`      | Two or more short items joined by arrows, left to right.                    |
| `handNote`     | A handwritten aside, optionally striking a word and pointing with an arrow. |
| `pills`        | A row of short tags that land one by one on their words.                    |
| `slamStamp`    | A one-word verdict stamped onto the frame for emphasis.                     |
| `statTile`     | One number that counts up, with its label and a late sub line.              |
| `timeline`     | Steps over time along a line, the last one hot.                             |
| `titleSwap`    | An old title struck and replaced by a new one on a word.                    |

## `special`

Allowed by `loud` only.

| Kind            | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `backdrop`      | A full-frame image drawn behind the person matte.                       |
| `chatCard`      | A chat exchange as bubbles, quoting only the cue's words.               |
| `frameEscape`   | Paper over the frame except a window, so the person steps out of it.    |
| `headlineStack` | Headlines stacking as paper slips, the last one in the accent.          |
| `lineChart`     | A line drawing on with a counting value at its tip and one focus point. |
| `paperCutout`   | A cut-out image on paper, behind or in front of the person.             |
| `phoneFrame`    | A phone bezel around a screen recording insert.                         |
| `pipeline`      | Exactly three stations of a process, drawn in turn.                     |
| `splitFlow`     | One idea splitting into two outcomes.                                   |
| `vsCard`        | Two options side by side for a comparison.                              |
