// Created by The Angelo Umali.
// v2 Live Motion tools: the beat map every learning cue comes from, and face boxes for framing and the no-face rule.
import { z } from "zod";
import { CanvasXSchema, CanvasYSchema, SourceSecondsSchema } from "../primitives.ts";
import { defineTool } from "./define.ts";

export const BEAT_GROUNDS = ["footage", "paper"] as const;
export const MAX_FACE_SAMPLES_PER_SECOND = 4;

const BeatSchema = z.strictObject({
  at: SourceSecondsSchema,
  word: z.string().min(1).max(80),
  visual: z.string().min(1).max(200),
  ground: z.enum(BEAT_GROUNDS),
});

/** Writes only the project's beat map; add_cue on a learning project refuses until one exists. */
export const setBeatMap = defineTool({
  input: z.strictObject({ beats: z.array(BeatSchema).min(1).max(400) }),
  output: z.strictObject({ beats: z.int().positive() }),
  approval: "auto",
  isReadOnly: false,
});

/** [x, y, w, h] on the 1080x1920 grid. */
const CanvasBoxSchema = z.tuple([CanvasXSchema, CanvasYSchema, z.number().nonnegative(), z.number().nonnegative()]);

export const FaceSampleSchema = z.strictObject({
  t: SourceSecondsSchema,
  faces: z.array(z.strictObject({ box: CanvasBoxSchema, score: z.number().min(0).max(1) })),
});

export const frameFaces = defineTool({
  input: z
    .strictObject({
      at: SourceSecondsSchema.optional(),
      end: SourceSecondsSchema.optional(),
      fps: z.number().positive().max(MAX_FACE_SAMPLES_PER_SECOND).optional(),
    })
    .refine((span) => span.at === undefined || span.end === undefined || span.end > span.at, { message: "end must be after at", path: ["end"] }),
  /** `band` is the picture inside any letterbox; reframe `cx`/`cy` are shares of it. */
  output: z.strictObject({ band: CanvasBoxSchema, samples: z.array(FaceSampleSchema) }),
  approval: "auto",
  isReadOnly: true,
});
