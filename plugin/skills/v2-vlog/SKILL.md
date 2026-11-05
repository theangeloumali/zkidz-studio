---
name: v2-vlog
description: Use for every edit whose project theme is "learning" (v2 Live Motion), before the cut spec, before the first cue and before calling the edit finished. The rules, the technique menu, the brand and the bar a learning-vlog edit must clear.
---

<!-- Created by The Angelo Umali. -->

# v2 Live Motion learning vlog

The learning theme is the house standard for a talking learning vlog: the edit proves the script. Every thing the speaker
names, every number he says and every claim he makes gets its visual on the word. Read this whole skill before `set_cuts`,
then follow `edit-director` for the flow and `cut-spec`, `cues`, `captions`, `reels` and `qc-gates` for the field details.

## Before the cut: ask about other people

When the footage shows anyone besides the creator, ask the user whether their faces are blurred. Never assume: some videos
blur everyone else, others do not. Put the answer in the cut spec's `blurFaces` (`"others"` or `"none"`); a render of
footage with more than one person refuses without it. Use a question card if you have one, otherwise ask in plain words
and wait for the answer.

## The rules (an edit that breaks one is not done)

1. **The edit proves the script.** Before any cue, write the beat map with `set_beat_map`: one row per beat with the word,
   its source time, the visual and whether it sits on footage or paper. Every cue comes from a row.
2. **No backdrops.** No plate behind a word or a number. Chips are labels, never backgrounds.
3. **No empty paper.** Every second of a `paperScene` carries a graphic that explains the line (`stepBars`, `listRows`, a
   `bigWord`, a count). A heading alone on cream is a fault.
4. **Nothing on his face** (eyes to chin, plus the forehead). Call `frame_faces` and keep every graphic above the face box
   minus about 80 px for the hairline, in the top band (baselines y 170–540 on the 1080 grid). Captions sit at y 1750,
   below his mouth and chin. `qc_master` fails the edit on any graphic pixel over the face.
5. **All text stays fully visible.** No word or number goes behind his head, hair or face, and none covers his face.
   Resize it or move it into clear space, usually the top band, or leave it out. **Text never overlaps text:** a chip, a
   big word's kicker, a heading and a caption each need their own space at the same moment. A big word's `kicker` sits just
   above the word, so it shares the top band with any `chipRail` on screen with it: use one or the other.
   `render_master` refuses colliding text before it draws a frame, and `qc_master` checks it again (`textClear`).
6. **Never invent.** A prompt, chat, receipt or call to action appears only when he says or did that thing, in his words.
   Counts start from 0 or from a value he says.
7. **No pictograms.** No stick figures, outline icons, clip-art or invented charts and numbers. Every visual is his own
   footage, or a real UI rebuilt and animated. Money and trading screens are generic: no brand, balance, ticker or price.
8. **Map every place.** A vlog that leaves home pins each place it visits on a real map (`routeMap`) the first time the
   video arrives there, with the name a viewer knows. Only proven places: the clip's own GPS, or a place the user names
   (the cut spec's `places`). Never home, so a video filmed at home has no map. `qc_master` fails an unpinned place (`map`).

## Outputs

Unless the user asks for one output only, make two:

- **The full edit:** the complete substantive story, with no length cap.
- **A reel of 120–180 seconds** (`set_reel`, see `reels`), counted on the finished reel, branding and ending included. Open
  it on the strongest hook. Never pad or loop to reach the minimum, and never call a highlight cut the full edit.

Each output passes `qc_master` and is exported on its own target (`full`, `reel`).

## Max creativity

- **Variety.** No technique carries more than 30 % of the headline beats, and none runs three in a row. Chips, paper and
  captions ride along and do not count as beats. `qc_master` checks it.
- **A moving camera.** The footage moves on the words that matter, as cut-spec `zooms`: `lean` where his face is already
  close, `push` for weight, `snap` for a punchline, `through-out` then `through-in` across a cut, `reveal` to open wide
  after a paper scene. No static stretch over about 6 s of footage.
- **Rack focus.** Where he turns inward ("focus", "what I learned"), add a cut-spec `focus` window so the room blurs
  behind him.
- **Live motion over words.** When he names a thing, show it working (the menu below). A word on screen is the fallback.
- **He stays on screen.** For a paper explainer longer than 3 s, shrink his footage into a `footageCard` beside it
  (`shrink` in, `grow` out), alternating sides beat to beat.
- **Music by default.** Set the cut spec's `music` sections (`cold`, `intro`, `chapter`, `outro`, with an `energy` each)
  across both outputs. The bed sits under his voice and ducks while he talks. Leave it out only when the user says so.
- **Honesty.** If the edit is not at this bar, say so and say what is missing. Never call it finished when it is not.

## Framing wide footage

A square or landscape source arrives letterboxed, and a letterboxed second shows the whole room. Set the cut spec's
`follow: "speaker"`: every kept second you have not framed yourself gets a 9:16 window on whoever is speaking, switching
when the speaker changes, and holding the last speaker while the voice comes from off screen. Add your own `reframes`
windows only where a shot needs another framing (`cx`, `cy` as shares of the picture); yours win. A source that already
fills 9:16 needs neither. `qc_master` fails a letterboxed second that is still in the edit (`framed`).

## The technique menu, by job

| He says…                              | Use                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| the one word that carries the line    | `bigWord` with `drop` or `tumble` in clear space, orange for the turn          |
| two words that swap                   | `bigWord` `slot` (a `fixed` line and the rolling words)                        |
| something he rules out                | `bigWord` `scribbleAt` or `strikeAt`                                           |
| a number or an age                    | `bigWord` `count` in clear space, with a `kicker` chip                         |
| a feeling or a level                  | `meterGauge`, the needle settling on its word                                  |
| a person or moment he mentions        | `footageCard` with `sourceSecond` and a `crop` that keeps the whole head       |
| money, saving, spending               | `phoneScreen` (`savings`, `allowance` or `cart`), his card beside it           |
| asking AI, a question and its answer  | `chatThread`: the question types and sends, the reply streams in his words     |
| typing a prompt or a command          | `typedPrompt` or `askField`                                                    |
| markets, trading                      | `tradeScreen` (live candles, no figures)                                       |
| a tally                               | `receiptPrint`, the total landing orange                                       |
| a process                             | `flowSteps` (`check`, `coins`, `unlock`)                                       |
| a comparison that rises               | `paperScene` + `stepBars` (no numbers) + `arrow`                               |
| a list he counts off                  | `paperScene` + `listRows` (`card: true` with a `note`), one pin per item       |
| a place he goes, a trip               | `routeMap`: the real map, a dashed gold route drawing stop to stop on the word |
| a short label for the beat            | `chipRail` at `y: 190`, centred, alone in the top band                         |
| the open and the loop                 | `paperScene` with `logo`, and a `footageCard` that grows or shrinks            |
| the closing ask, only if he makes one | `commentCta`                                                                   |

Call `list_cue_kinds` for each kind's fields and width caps. Every `at` and `*At` inside a cue is seconds after the cue's
`at`, landing on its word.

## The brand

Paper `#F3EFE8`, navy ink `#172230`, gold `#C9A838` for fills (chips, pills, bars, checks, strikes, edges, arrows) with
navy text on it, and orange `#EA580C` for a highlighted word. Gold text is too light; never steel blue. Chakra Petch sets
display type and captions, JetBrains Mono the chips. The opening `paperScene` carries the logo and hosts the brand intro
(`intro: true`, `introAt` on the first natural pause after the hook). Set the cut spec's `grade` to `"learning"`.

## Captions

The render draws word captions on a learning project. Call `make_caption_phrases`, then `set_captions` with each entry's
keyword `pills` (words of its `en`) and a `scale` between 0.6 and 2.0 for the line that needs weight.

## Done means

1. `qc_master` passes every blocking gate on both outputs: frames, loudness, true peak, motion, density, variety, face
   clear, text clear, map, and on wide footage framed (and faces blurred when `blurFaces` is `"others"`).
2. A preview pass at every beat (`render_preview`, four stills a call) finds nothing left from the fault list in
   `references/critique.md`, on the full edit and the reel.
3. Then `export_deliverable` for each output, and `suggest_lessons` for what the user corrected.

Hands to next: a beat map, a cut spec with the blur answer, `follow`, zooms, focus, grade and music, a learning cue sheet and a reel → `cut-spec`, `cues`, `captions` and `reels`, then `qc-gates`.
