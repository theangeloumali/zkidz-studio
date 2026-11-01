// Created by The Angelo Umali.
// Reference-style tools (slice D): look at a reference video, then set the project's style over its theme.
import { z } from "zod";
import { ProjectStyleSchema } from "../api/dto.ts";
import { IdSchema } from "../primitives.ts";
import { ProjectPathSchema, defineTool } from "./define.ts";

export const MAX_REFERENCE_FRAMES = 6;

export const sampleReference = defineTool({
  input: z.strictObject({ assetId: IdSchema, frames: z.int().min(1).max(MAX_REFERENCE_FRAMES).optional() }),
  output: z.strictObject({
    durationS: z.number().nonnegative(),
    /** A 3×3 grid across the whole reference; also returned as an image block. */
    contactSheet: ProjectPathSchema,
    frames: z.array(z.strictObject({ at: z.number().nonnegative(), path: ProjectPathSchema })).max(MAX_REFERENCE_FRAMES),
    shotChangesPerMinute: z.number().nonnegative(),
    averageShotS: z.number().nonnegative(),
    loudnessLufs: z.number().nullable(),
  }),
  approval: "auto",
  isReadOnly: true,
});

/** Auto, not gated: the Style panel shows the result with a Reset, so a wrong guess costs one click. */
export const setProjectStyle = defineTool({
  input: z.strictObject({ style: ProjectStyleSchema }),
  output: z.strictObject({ style: ProjectStyleSchema, warnings: z.array(z.string()) }),
  approval: "auto",
  isReadOnly: false,
});
