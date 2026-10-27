// Created by The Angelo Umali.
// captions/vN.phrases.json (engine output) and captions/vN.json (agent-authored English groups).
import { z } from "zod";
import { CanvasYSchema, sourceSpan } from "../primitives.ts";

export const PhraseIdSchema = z.int().nonnegative();

/** `reel` is the index of the Reels keep holding the phrase, null when it is in the full edit only. */
export const CaptionPhraseSchema = sourceSpan({ id: PhraseIdSchema, reel: z.int().nonnegative().nullable(), text: z.string() });

/** Wrap and reel-edge checks need font metrics and the phrase list, so they run in `set_captions`, not here. `bottom` is
 * the plate's lower edge on the canvas, for a line the default band would put over the speaker's mouth. */
export const CaptionEntrySchema = z.strictObject({ ids: z.array(PhraseIdSchema).min(1), en: z.string().min(1), bottom: CanvasYSchema.optional() });

export type CaptionPhrase = z.infer<typeof CaptionPhraseSchema>;
export type CaptionEntry = z.infer<typeof CaptionEntrySchema>;
