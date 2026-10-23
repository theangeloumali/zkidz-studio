// Created by The Angelo Umali.
// Phase 6 onboarding contracts: the shipped presets as the server serves them, and starting an edit from a template.
import { z } from "zod";
import { INGEST_MODES, HomeTemplateSchema, StylePresetSchema } from "../presets.ts";
import { IdSchema } from "../primitives.ts";
import { StyleIdSchema } from "./dto.ts";

/** A shipped style is one the user can pick, so its id is a StyleId. */
export const StyleCardSchema = StylePresetSchema.extend({ id: StyleIdSchema });

export const StyleCardsSchema = z.strictObject({ styles: z.array(StyleCardSchema) });
export const HomeTemplatesSchema = z.strictObject({ templates: z.array(HomeTemplateSchema) });

/** clipAssetIds in edit order; insertAssetId is the showcase's screen recording. */
export const StartTemplateRequestSchema = z.strictObject({
  templateId: z.string().min(1),
  clipAssetIds: z.array(IdSchema).min(1),
  insertAssetId: IdSchema.optional(),
});

export const ProjectTemplateSchema = z.strictObject({ templateId: z.string().min(1), ingestMode: z.enum(INGEST_MODES) });
export const StartTemplateResponseSchema = ProjectTemplateSchema.extend({ ingestJobId: IdSchema });

export type StyleCard = z.infer<typeof StyleCardSchema>;
export type StartTemplateRequest = z.infer<typeof StartTemplateRequestSchema>;
export type ProjectTemplate = z.infer<typeof ProjectTemplateSchema>;
