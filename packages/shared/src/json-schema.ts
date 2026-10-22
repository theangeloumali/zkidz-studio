// Created by The Angelo Umali.
// The Python engine validates specs against these JSON Schemas, so zod stays the single source (plan §7.7).
import { z } from "zod";
import { CaptionEntrySchema, CaptionPhraseSchema } from "./specs/captions.ts";
import { CueSheetSchema, ReelCuePatchSchema } from "./specs/cues.ts";
import { CutSpecSchema } from "./specs/cut-spec.ts";
import { InsertSpecSchema } from "./specs/inserts.ts";
import { ReelSpecSchema } from "./specs/reel-spec.ts";

const SPEC_SCHEMA_BY_FILE = {
  "cut-spec.json": CutSpecSchema,
  "reel-spec.json": ReelSpecSchema,
  "cue-sheet.json": CueSheetSchema,
  "reel-cue-patches.json": z.array(ReelCuePatchSchema),
  "caption-phrases.json": z.array(CaptionPhraseSchema),
  "caption-entries.json": z.array(CaptionEntrySchema),
  "insert-spec.json": InsertSpecSchema,
} as const;

/** File name → JSON text. Refinements (end after at, source order) do not survive; the engine re-checks those. */
export function renderSpecJsonSchemaFiles(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(SPEC_SCHEMA_BY_FILE).map(([fileName, specSchema]) => [fileName, `${JSON.stringify(z.toJSONSchema(specSchema), null, 2)}\n`]),
  );
}
