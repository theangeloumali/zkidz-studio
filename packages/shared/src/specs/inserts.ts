// Created by The Angelo Umali.
// inserts/vN.json: where a screen recording or film plays inside a showcase source.
import { z } from "zod";
import { IdSchema, SourceSecondsSchema, sourceSpan } from "../primitives.ts";

/** Mirrors engine showcase.py PANELS; omitted, the engine picks by the insert's shape. */
export const INSERT_PANELS = ["portrait", "landscape"] as const;

export const InsertSchema = sourceSpan({
  srcAssetId: IdSchema,
  srcAt: SourceSecondsSchema,
  panel: z.enum(INSERT_PANELS).optional(),
  note: z.string().optional(),
});

export const InsertSpecSchema = z.array(InsertSchema);

export type Insert = z.infer<typeof InsertSchema>;
export type InsertSpec = z.infer<typeof InsertSpecSchema>;
