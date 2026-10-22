// Created by The Angelo Umali.
// cues/vN.json replaces executable cues/vN.js (plan §7.7). Fields mirror the engine's documented cue kinds;
// `at`/`end` are source seconds and every nested `at`/`subAt`/`swapAt` is a word pin after the cue's `at`.
import { z } from "zod";
import { CanvasXSchema, CanvasYSchema, PinSecondsSchema, SourceSecondsSchema, sourceSpan } from "../primitives.ts";

const textSchema = z.string().min(1);
const optionalTextSchema = z.string().optional();

/** The transcript word a cue lands on; Phase 3 checks `at` sits within -0.2..+1.8 s of it (plan §7.7). */
export const CueAnchorSchema = z.strictObject({ phrase: textSchema, wordIndex: z.int().nonnegative() });

function cueKind<Kind extends string, Fields extends z.ZodRawShape>(kind: Kind, fields: Fields) {
  return sourceSpan({ kind: z.literal(kind), id: z.string().min(1).optional(), anchor: CueAnchorSchema.optional(), ...fields });
}

const pinnedTextSchema = z.strictObject({ text: textSchema, at: PinSecondsSchema });
const sideSchema = z.strictObject({ text: textSchema, sub: optionalTextSchema });

export const KEYWORD_TONES = ["footage", "paper", "chip"] as const;
export const CUTAWAY_CUE_STYLES = ["wipe", "card"] as const;

const cueSchemas = [
  cueKind("hookTitle", {
    kicker: optionalTextSchema,
    lines: z.array(textSchema).min(1).max(3),
    accentLine: z.int().nonnegative().optional(),
    intro: z.boolean().optional(),
  }),
  cueKind("lowerThird", { name: textSchema, sub: optionalTextSchema }),
  cueKind("chapterCard", { index: optionalTextSchema, kicker: optionalTextSchema, title: textSchema, sub: optionalTextSchema }),
  cueKind("keyword", { text: textSchema, tone: z.enum(KEYWORD_TONES).optional(), accent: z.boolean().optional(), y: CanvasYSchema.optional() }),
  cueKind("comment", { text: textSchema }),
  cueKind("handNote", {
    text: textSchema,
    strike: optionalTextSchema,
    y: CanvasYSchema.optional(),
    arrow: z.tuple([CanvasXSchema, CanvasYSchema, CanvasXSchema, CanvasYSchema]).optional(),
  }),
  cueKind("slamStamp", { text: textSchema, sub: optionalTextSchema, x: CanvasXSchema.optional(), y: CanvasYSchema.optional() }),
  cueKind("censor", { x: CanvasXSchema, y: CanvasYSchema }),
  cueKind("statTile", {
    value: z.number().finite(),
    prefix: optionalTextSchema,
    suffix: optionalTextSchema,
    label: textSchema,
    sub: optionalTextSchema,
    subAt: PinSecondsSchema.optional(),
  }),
  cueKind("timeline", {
    text: optionalTextSchema,
    steps: z.array(z.strictObject({ label: textSchema, sub: optionalTextSchema, at: PinSecondsSchema, hot: z.boolean().optional() })).min(1),
  }),
  cueKind("titleSwap", { label: textSchema, old: textSchema, new: textSchema, swapAt: PinSecondsSchema }),
  cueKind("pills", {
    text: optionalTextSchema,
    items: z.array(z.strictObject({ text: textSchema, at: PinSecondsSchema, tone: z.literal("gold").optional() })).min(1),
  }),
  cueKind("criteriaCard", { kicker: optionalTextSchema, title: textSchema, rows: z.array(pinnedTextSchema).min(1) }),
  cueKind("checklist", { text: textSchema, rows: z.array(z.strictObject({ text: textSchema, ok: z.boolean(), at: PinSecondsSchema })).min(1) }),
  cueKind("flowRow", { text: textSchema, items: z.array(textSchema).min(2), step: z.number().positive().optional() }),
  cueKind("chips", {
    text: textSchema,
    items: z
      .array(
        z.strictObject({ text: textSchema, at: PinSecondsSchema.optional(), hot: z.boolean().optional(), tag: optionalTextSchema, note: optionalTextSchema }),
      )
      .min(1),
  }),
  cueKind("vsCard", { left: sideSchema, right: sideSchema }),
  cueKind("splitFlow", { text: textSchema, left: sideSchema, right: sideSchema }),
  // Exactly three stations; a `steps` array here crashed a render deep into the encode (zkidz-films learnings).
  cueKind("pipeline", { labels: z.tuple([textSchema, textSchema, textSchema]) }),
  cueKind("endCard", {
    cta: textSchema,
    sign: optionalTextSchema,
    y: CanvasYSchema.optional(),
    scale: z.number().positive().max(1).optional(),
    signY: CanvasYSchema.optional(),
  }),
  cueKind("caption", { text: textSchema, bottom: CanvasYSchema.optional() }),
  cueKind("cutaway", { title: textSchema, sub: optionalTextSchema, style: z.enum(CUTAWAY_CUE_STYLES).optional() }),
] as const;

export const CueSchema = z.discriminatedUnion("kind", cueSchemas);
export const CUE_KINDS = cueSchemas.map((cueSchema) => cueSchema.shape.kind.value);
export const CueSheetSchema = z.array(CueSchema);

export const CueMatchSchema = z.strictObject({ kind: z.enum(CUE_KINDS), at: SourceSecondsSchema });

/** A Reels override edits the base sheet by match, never by array index (the old splice crash, plan §7.7). */
export const ReelCuePatchSchema = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("remove"), match: CueMatchSchema }),
  z.strictObject({ op: z.literal("replace"), match: CueMatchSchema, cue: CueSchema }),
]);

export type Cue = z.infer<typeof CueSchema>;
export type CueKind = Cue["kind"];
export type ReelCuePatch = z.infer<typeof ReelCuePatchSchema>;
