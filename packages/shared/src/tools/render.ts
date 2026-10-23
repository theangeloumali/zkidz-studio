// Created by The Angelo Umali.
// Preview, render, QC and delivery tools (plan §6.8, §7.6).
import { z } from "zod";
import { DeliverableKindSchema } from "../enums.ts";
import { IdSchema, CanvasXSchema, CanvasYSchema, sourceSpan } from "../primitives.ts";
import { CueSchema } from "../specs/cues.ts";
import { JobHandleSchema, ProjectPathSchema, defineTool } from "./define.ts";

export const RENDER_TARGETS = ["full", "reel"] as const;
export const RENDER_QUALITIES = ["draft", "final", "4k"] as const;
const MAX_PREVIEW_STILLS = 4;

const RenderTargetSchema = z.enum(RENDER_TARGETS);
/** Seconds on the edited timeline, unlike spec times. */
const EditedSecondsSchema = z.number().finite().nonnegative();
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const renderPreview = defineTool({
  input: z.strictObject({ at: z.array(EditedSecondsSchema).min(1).max(MAX_PREVIEW_STILLS).optional(), guides: z.boolean().optional() }),
  output: z.strictObject({ stills: z.array(z.strictObject({ at: EditedSecondsSchema, path: ProjectPathSchema })).max(MAX_PREVIEW_STILLS) }),
  approval: "auto",
  isReadOnly: true,
});

export const checkMotion = defineTool({
  input: z.strictObject({
    stage: z.enum(["source", "master"]),
    regions: z.array(z.strictObject({ x: CanvasXSchema, y: CanvasYSchema, w: z.number().positive(), h: z.number().positive() })).optional(),
  }),
  output: z.strictObject({
    verdict: z.enum(["PASS", "FAIL"]),
    shots: z.array(sourceSpan({ score: z.number().nonnegative(), originalScore: z.number().nonnegative(), isFrozen: z.boolean() })),
  }),
  approval: "auto",
  isReadOnly: true,
});

export const makeCovers = defineTool({
  input: z.strictObject({
    variants: z.array(z.strictObject({ source: z.enum(["intro", "free"]), at: EditedSecondsSchema, cue: CueSchema.optional() })).min(1),
  }),
  output: z.strictObject({ covers: z.array(z.strictObject({ path: ProjectPathSchema })) }),
  approval: "auto",
  isReadOnly: false,
});

export const MasterRenderResultSchema = z.strictObject({
  path: ProjectPathSchema,
  frames: z.int().positive(),
  lufs: z.number(),
  truePeak: z.number(),
  bytes: z.int().positive(),
});

export const renderMaster = defineTool({
  input: z.strictObject({ target: RenderTargetSchema, quality: z.enum(RENDER_QUALITIES) }),
  output: JobHandleSchema,
  approval: "gate",
  isReadOnly: false,
});

export const qcMaster = defineTool({
  input: z.strictObject({ target: RenderTargetSchema }),
  output: z.strictObject({ ok: z.boolean(), checks: z.array(z.strictObject({ name: z.string().min(1), ok: z.boolean(), detail: z.string() })) }),
  approval: "auto",
  isReadOnly: true,
});

export const exportDeliverable = defineTool({
  input: z.strictObject({ kinds: z.array(DeliverableKindSchema).min(1) }),
  output: z.strictObject({ deliverables: z.array(z.strictObject({ kind: DeliverableKindSchema, path: ProjectPathSchema, sha256: Sha256Schema })) }),
  approval: "gate",
  isReadOnly: false,
});

export const deleteAsset = defineTool({
  input: z.strictObject({ assetId: IdSchema }),
  output: z.strictObject({ ok: z.literal(true) }),
  approval: "gate",
  isReadOnly: false,
});
