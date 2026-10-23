<!-- Created by The Angelo Umali. -->

# ZKidz presets

Data the app reads for onboarding and the Home screen. Both shapes are contracts in `@zks/shared` (`presets.ts`).

## Style presets (`styles/`)

The style cards on the setup screen. Each one names its theme, the manifest tiers it draws cards from (captions and
cut-derived kinds are always on), its sound level, whether the brand intro plays, the `guidance` the agent receives with the
user's rules (500 characters at most), and a `sample` cue sheet the 5-second sample render plays.

| Id      | Cards                 | Sound     | Intro |
| ------- | --------------------- | --------- | ----- |
| `zkidz` | core, accent          | light     | yes   |
| `plain` | none                  | none      | no    |
| `loud`  | core, accent, special | every cut | yes   |

## Home templates (`templates/`)

A template is a starter prompt plus an ingest mode: `single` (one clip), `join` (several clips in order) or `showcase` (a
screen recording placed as a panel over the camera).

Every file is named after its `id`; `scripts/tests/zkidz-presets.test.mjs` checks the schema and that every sample cue fits
the zkidz manifest's widths.
