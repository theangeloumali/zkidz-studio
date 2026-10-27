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
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export const renderPreview = defineTool({
  input: z.strictObject({ at: z.array(EditedSecondsSchema).min(1).max(MAX_PREVIEW_STILLS).optional(), guides: z.boolean().optional() }),
  output: z.strictObject({ stills: z.array(z.strictObject({ at: EditedSecondsSchema, path: ProjectPathSchema })).max(MAX_PREVIEW_STILLS) }),
  approval: "auto",
  /** It rebuilds the edit (work/edl, the edit's audio), so it must not run beside another write. */
  isReadOnly: false,
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

/** Instagram's caption limit, the tightest of the platforms the post goes to. */
const MAX_POST_CAPTION_CHARS = 2200;

export const makeCovers = defineTool({
  input: z.strictObject({
    variants: z.array(z.strictObject({ source: z.enum(["intro", "free"]), at: EditedSecondsSchema, cue: CueSchema.optional() })).min(1),
    /** "reel" draws the Reels covers (reels-cover-A/B); default "full". */
    target: RenderTargetSchema.optional(),
    /** The post's caption and hashtags, shipped as caption.txt. */
    postCaption: z.string().trim().min(1).max(MAX_POST_CAPTION_CHARS).optional(),
  }),
  output: z.strictObject({ covers: z.array(z.strictObject({ path: ProjectPathSchema })), postCaption: ProjectPathSchema.optional() }),
  approval: "auto",
  isReadOnly: false,
});

/** A spec snapshot under work/, named by the SHA-256 of the spec set it holds. */
export const SpecsSnapshotRefSchema = z.string().regex(/^snapshots\/[0-9a-f]{64}$/);

/** source and specsSnapshot are what the master was cut from; QC and export are held to the same pair. relPath is an
 * in-place clip's realpath. sha256 binds the result to the bytes this render produced, as a later render that stops
 * after writing the same path leaves its own there. inputs is the engine's opaque map of the files QC re-checks. */
export const MasterRenderResultSchema = z.strictObject({
  path: ProjectPathSchema,
  frames: z.int().positive(),
  lufs: z.number(),
  truePeak: z.number(),
  bytes: z.int().positive(),
  sha256: Sha256Schema,
  inputs: z.record(z.string().min(1), z.string().min(1)),
  source: z.strictObject({ assetId: IdSchema, relPath: z.string().min(1) }),
  specsSnapshot: SpecsSnapshotRefSchema,
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
