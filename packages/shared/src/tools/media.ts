// Created by The Angelo Umali.
// Project, media and transcript tools (plan §6.8).
import { z } from "zod";
import { AssetIdSchema, FrameRateSchema, SourceSecondsSchema, sourceSpan } from "../primitives.ts";
import { InsertSpecSchema } from "../specs/inserts.ts";
import { EmptyInputSchema, JobHandleSchema, TranscriptWordSchema, defineTool } from "./define.ts";

/** Probe order of the hardware backends (plan §7.2). */
export const RENDER_PROFILES = ["nvidia", "videotoolbox", "qsv", "amf", "vaapi", "cpu"] as const;
export const WHISPER_MODELS = ["turbo", "small", "base"] as const;

const RotationSchema = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
const transcriptRangeShape = { from: SourceSecondsSchema.optional(), to: SourceSecondsSchema.optional() };

export const projectInfo = defineTool({
  input: EmptyInputSchema,
  output: z.strictObject({
    videoId: z.string(),
    clips: z.array(
      z.strictObject({ assetId: AssetIdSchema, name: z.string(), durationS: z.number(), fps: FrameRateSchema, rotation: RotationSchema, hdr: z.boolean() }),
    ),
    theme: z.string(),
    rules: z.array(z.string()),
  }),
  approval: "auto",
  isReadOnly: true,
});

export const getCapabilities = defineTool({
  input: EmptyInputSchema,
  output: z.strictObject({
    profile: z.enum(RENDER_PROFILES),
    features: z.strictObject({ uhd: z.boolean(), intro: z.boolean(), zoomExpr: z.boolean(), matte: z.boolean() }),
    transcribe: z.enum(["whisper.cpp", "ffmpeg-whisper"]),
  }),
  approval: "auto",
  isReadOnly: true,
});

export const probeMedia = defineTool({
  input: z.strictObject({ assetId: AssetIdSchema }),
  output: z.strictObject({
    durationS: z.number().nonnegative(),
    fps: FrameRateSchema,
    size: z.strictObject({ width: z.int().positive(), height: z.int().positive() }),
    rotation: RotationSchema,
    hdr: z.boolean(),
    audio: z.strictObject({ rate: z.int().positive(), channels: z.int().positive() }).nullable(),
    vfr: z.boolean(),
  }),
  approval: "auto",
  isReadOnly: true,
});

export const IngestResultSchema = z.strictObject({
  sourceAssetId: AssetIdSchema,
  frames: z.int().positive(),
  joins: z.array(z.strictObject({ assetId: AssetIdSchema, at: SourceSecondsSchema })),
});

export const ingest = defineTool({
  input: z.strictObject({
    clips: z.array(z.strictObject({ assetId: AssetIdSchema, zoom: z.number().positive().optional() })).min(1),
    inserts: InsertSpecSchema.optional(),
  }),
  output: JobHandleSchema,
  approval: "auto",
  isReadOnly: false,
});

export const TranscribeResultSchema = z.strictObject({ words: z.int().nonnegative(), chunks: z.int().positive() });

export const transcribe = defineTool({
  input: z.strictObject({
    language: z
      .string()
      .regex(/^(auto|[a-z]{2,3})$/)
      .optional(),
    model: z.enum(WHISPER_MODELS).optional(),
  }),
  output: JobHandleSchema,
  approval: "auto",
  isReadOnly: false,
});

const transcriptPageShape = { page: z.int().positive(), pageCount: z.int().nonnegative() };

export const readTranscript = defineTool({
  input: z.strictObject({ ...transcriptRangeShape, format: z.enum(["readable", "words"]), page: z.int().positive().optional() }),
  output: z.discriminatedUnion("format", [
    z.strictObject({ format: z.literal("readable"), ...transcriptPageShape, text: z.string() }),
    z.strictObject({ format: z.literal("words"), ...transcriptPageShape, words: z.array(TranscriptWordSchema) }),
  ]),
  approval: "auto",
  isReadOnly: true,
});

export const checkWindow = defineTool({
  input: z.strictObject({ ranges: z.array(sourceSpan({})).min(1) }),
  output: z.strictObject({ windows: z.array(sourceSpan({ words: z.array(TranscriptWordSchema) })) }),
  approval: "auto",
  isReadOnly: true,
});

export const energyProfile = defineTool({
  input: z.strictObject({ from: SourceSecondsSchema, to: SourceSecondsSchema }),
  output: z.strictObject({ stepMs: z.int().positive(), db: z.array(z.number()), quietRuns: z.array(sourceSpan({})) }),
  approval: "auto",
  isReadOnly: true,
});
