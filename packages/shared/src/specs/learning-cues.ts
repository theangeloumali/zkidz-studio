// Created by The Angelo Umali.
// The v2 Live Motion learning-vlog kinds (engine docs/cues-hf.md "Learning-vlog kinds"). Every `at` and `*At` is a word
// pin after the cue's `at`; `sourceSecond` is absolute. A bigWord has no `plate`: the v2 rules ban backdrops behind words.
import { z } from "zod";
import { CanvasXSchema, CanvasYSchema, FractionSchema, PinSecondsSchema, SourceSecondsSchema } from "../primitives.ts";
import { learningCueKind, HexColorSchema, optionalTextSchema, textSchema } from "./cue-kind.ts";

const positiveSchema = z.number().positive();
const placed = { x: CanvasXSchema.optional(), y: CanvasYSchema.optional() };

const LEARNING_TONES = ["accent", "ink", "ghost"] as const;
const PAPER_ENTERS = ["up", "left", "cut"] as const;
const PAPER_EXITS = ["up", "right", "down", "cut"] as const;
const PHONE_SCREENS = ["savings", "allowance", "cart"] as const;
const FLOW_STEP_KINDS = ["check", "coins", "unlock"] as const;
const ROW_MARKS = ["check", "cross"] as const;

const countSchema = z.strictObject({
  from: z.number().nonnegative(),
  to: z.number().nonnegative(),
  decimals: z.int().min(0).max(3).optional(),
  pad: z.int().min(0).max(6).optional(),
  prefix: optionalTextSchema,
  suffix: optionalTextSchema,
});

const slotSchema = z.strictObject({
  fixed: textSchema,
  words: z.array(z.strictObject({ text: textSchema, at: PinSecondsSchema, color: HexColorSchema.optional() })).min(1),
});

const cardMoveSchema = z.strictObject({ at: PinSecondsSchema.optional(), dur: positiveSchema });
const canvasRectSchema = z.tuple([CanvasXSchema, CanvasYSchema, positiveSchema, positiveSchema]);
/** A footage crop: even-sized (4:2:0 video) and inside the 1080x1920 frame, as build.js checkCrop requires. */
const cropRectSchema = canvasRectSchema.refine(([x, y, w, h]) => w % 2 === 0 && h % 2 === 0 && x + w <= 1080 && y + h <= 1920, {
  message: "crop is [x, y, w, h] with an even width and height, inside the 1080x1920 frame",
});
const MAP_REGIONS = ["japan", "asia", "world"] as const;
const longitudeSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);
const placeSchema = z.strictObject({ name: textSchema, lon: longitudeSchema, lat: latitudeSchema });

export const learningCueSchemas = [
  learningCueKind("paperScene", {
    enter: z.enum(PAPER_ENTERS).optional(),
    exit: z.enum(PAPER_EXITS).optional(),
    label: optionalTextSchema,
    labelX: CanvasXSchema.optional(),
    labelY: CanvasYSchema.optional(),
    logo: z.strictObject({ x: CanvasXSchema.optional(), y: CanvasYSchema.optional(), height: positiveSchema.optional() }).optional(),
    intro: z.boolean().optional(),
    introAt: PinSecondsSchema.optional(),
  }),
  learningCueKind("bigWord", {
    text: textSchema,
    size: positiveSchema.optional(),
    ...placed,
    color: HexColorSchema.optional(),
    kicker: optionalTextSchema,
    hit: z.boolean().optional(),
    strikeAt: PinSecondsSchema.optional(),
    scribbleAt: PinSecondsSchema.optional(),
    drop: z.boolean().optional(),
    tumble: z.boolean().optional(),
    count: countSchema.optional(),
    countAt: PinSecondsSchema.optional(),
    steps: z
      .array(z.strictObject({ at: PinSecondsSchema, to: z.number().nonnegative() }))
      .min(1)
      .optional(),
    from: z.number().nonnegative().optional(),
    prefix: optionalTextSchema,
    suffix: optionalTextSchema,
    pad: z.int().min(0).max(6).optional(),
    slot: slotSchema.optional(),
  }),
  learningCueKind("chipRail", {
    chips: z.array(z.strictObject({ text: textSchema, at: PinSecondsSchema.optional(), tone: z.enum(LEARNING_TONES).optional() })).min(1),
    ...placed,
    align: z.enum(["start", "center"]).optional(),
    size: positiveSchema.optional(),
  }),
  learningCueKind("stepBars", {
    bars: z
      .array(z.strictObject({ label: textSchema, height: z.number().gt(0).max(1), at: PinSecondsSchema, tone: z.enum(["accent", "ink"]).optional() }))
      .min(1),
    arrow: z.boolean().optional(),
    ...placed,
    maxHeight: positiveSchema.optional(),
    barWidth: positiveSchema.optional(),
  }),
  learningCueKind("listRows", {
    rows: z
      .array(
        z.strictObject({
          text: textSchema,
          at: PinSecondsSchema,
          mark: z.enum(ROW_MARKS).optional(),
          tone: z.enum(["ink", "accent"]).optional(),
          note: optionalTextSchema,
        }),
      )
      .min(1),
    ...placed,
    size: positiveSchema.optional(),
    gap: positiveSchema.optional(),
    card: z.boolean().optional(),
    cardWidth: positiveSchema.optional(),
  }),
  learningCueKind("meterGauge", { label: textSchema, tag: optionalTextSchema, level: FractionSchema, settleAt: PinSecondsSchema.optional(), ...placed }),
  learningCueKind("receiptPrint", {
    title: textSchema,
    lines: z.array(z.strictObject({ text: textSchema, value: optionalTextSchema, at: PinSecondsSchema })).min(1),
    total: z.number().nonnegative(),
    totalFrom: z.number().nonnegative().optional(),
    totalAt: PinSecondsSchema,
    ...placed,
  }),
  learningCueKind("phoneScreen", {
    screen: z.enum(PHONE_SCREENS),
    beats: z
      .array(
        z.strictObject({
          at: PinSecondsSchema,
          fill: FractionSchema.optional(),
          pay: z.boolean().optional(),
          jar: z.enum(["save", "spend"]).optional(),
          remove: z.boolean().optional(),
        }),
      )
      .min(1),
    ...placed,
    w: positiveSchema.optional(),
    tilt: z.number().min(-45).max(45).optional(),
    item: optionalTextSchema,
  }),
  learningCueKind("chatThread", {
    title: optionalTextSchema,
    messages: z
      .array(z.strictObject({ from: z.enum(["me", "assistant"]), text: textSchema, at: PinSecondsSchema, sendAt: PinSecondsSchema.optional() }))
      .min(1),
    ...placed,
    w: positiveSchema.optional(),
  }),
  learningCueKind("tradeScreen", { seed: z.int().nonnegative().optional(), ...placed }),
  learningCueKind("flowSteps", {
    steps: z
      .array(z.strictObject({ label: textSchema, kind: z.enum(FLOW_STEP_KINDS), at: PinSecondsSchema }))
      .min(1)
      .max(3),
    ...placed,
  }),
  learningCueKind("typedPrompt", {
    title: optionalTextSchema,
    text: textSchema,
    typeAt: PinSecondsSchema.optional(),
    cps: positiveSchema.optional(),
    output: z.array(textSchema).optional(),
    outputAt: PinSecondsSchema.optional(),
    ...placed,
    w: positiveSchema.optional(),
  }),
  learningCueKind("askField", {
    label: optionalTextSchema,
    placeholder: optionalTextSchema,
    text: textSchema,
    typeAt: PinSecondsSchema.optional(),
    cps: positiveSchema.optional(),
    sendAt: PinSecondsSchema,
    status: z.array(z.strictObject({ at: PinSecondsSchema, text: textSchema, ok: z.boolean().optional() })).optional(),
    ...placed,
    w: positiveSchema.optional(),
  }),
  learningCueKind("commentCta", {
    lead: optionalTextSchema,
    word: textSchema,
    sub: optionalTextSchema,
    size: positiveSchema.optional(),
    ...placed,
    bubbleAt: PinSecondsSchema.optional(),
    wordAt: PinSecondsSchema.optional(),
    subAt: PinSecondsSchema.optional(),
  }),
  learningCueKind("receipt", {
    input: z.strictObject({
      clips: z.array(z.strictObject({ label: textSchema, seconds: positiveSchema })).min(1),
      seconds: positiveSchema,
    }),
    removed: z.array(z.strictObject({ start: z.number().nonnegative(), end: positiveSchema, why: textSchema })),
    output: positiveSchema,
    countAt: PinSecondsSchema.optional(),
    badAt: PinSecondsSchema.optional(),
    pausesAt: PinSecondsSchema.optional(),
    collapseAt: PinSecondsSchema.optional(),
    x: CanvasXSchema.optional(),
    w: positiveSchema.optional(),
  }),
  learningCueKind("footageCard", {
    rect: canvasRectSchema.optional(),
    radius: z.number().nonnegative().optional(),
    grow: cardMoveSchema.optional(),
    shrink: cardMoveSchema.optional(),
    file: optionalTextSchema,
    timecode: z.boolean().optional(),
    chips: z.array(z.strictObject({ text: textSchema, tone: z.enum(LEARNING_TONES).optional() })).optional(),
    progress: z.boolean().optional(),
    status: optionalTextSchema,
    grade: z.enum(["edit", "raw"]).optional(),
    sourceSecond: SourceSecondsSchema.optional(),
    crop: cropRectSchema.optional(),
  }),
  learningCueKind("gradeWipe", { wipeAt: PinSecondsSchema }),
  learningCueKind("routeMap", {
    /** A named map or [lonW, latS, lonE, latN]; one across the antimeridian is refused at build. */
    region: z.union([z.enum(MAP_REGIONS), z.tuple([longitudeSchema, latitudeSchema, longitudeSchema, latitudeSchema])]),
    full: z.boolean().optional(),
    follow: z.boolean().optional(),
    from: placeSchema.optional(),
    stops: z.array(placeSchema.extend({ sub: optionalTextSchema, at: PinSecondsSchema })).min(1),
    box: z.strictObject({ x: CanvasXSchema, y: CanvasYSchema, w: positiveSchema, h: positiveSchema }).optional(),
  }),
] as const;
