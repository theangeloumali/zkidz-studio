// Created by The Angelo Umali.
// Style presets and Home templates shipped under themes/<id>/presets/ (plan §9.1, Phase 6).
import { z } from "zod";
import { CueSheetSchema } from "./specs/cues.ts";

/** Each style card plays the same short sample in its own look. */
export const STYLE_SAMPLE_SECONDS = 5;
/** A preset's guidance joins the prompt beside the user's rules, so it obeys the same cap. */
export const STYLE_GUIDANCE_MAX_CHARS = 500;
/** Mirrors the engine's theme manifest tiers (theme_index.TIERS). */
export const CARD_TIERS = ["core", "accent", "special"] as const;
export const SFX_LEVELS = ["none", "light", "every-cut"] as const;
/** `single` ingests one clip, `join` several in order, `showcase` a screen recording as a panel over the camera. */
export const INGEST_MODES = ["single", "join", "showcase"] as const;

const PresetIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase letters, digits and -");

const sampleCueSheetSchema = CueSheetSchema.refine((cues) => cues.every((cue) => cue.end <= STYLE_SAMPLE_SECONDS), {
  message: `every sample cue ends by ${STYLE_SAMPLE_SECONDS} s`,
});

export const StylePresetSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: PresetIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  /** Theme pack id; themes load only from the repo's themes/ folder, never a path. */
  theme: PresetIdSchema,
  /** Manifest tiers the style draws cards from; captions and cut-derived kinds are always on. */
  cardTiers: z.array(z.enum(CARD_TIERS)),
  sfx: z.enum(SFX_LEVELS),
  intro: z.boolean(),
  guidance: z.string().min(1).max(STYLE_GUIDANCE_MAX_CHARS),
  sample: sampleCueSheetSchema,
});

export const HomeTemplateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: PresetIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  ingestMode: z.enum(INGEST_MODES),
  prompt: z.string().min(1),
});

export type StylePreset = z.infer<typeof StylePresetSchema>;
export type HomeTemplate = z.infer<typeof HomeTemplateSchema>;
export type IngestMode = (typeof INGEST_MODES)[number];
