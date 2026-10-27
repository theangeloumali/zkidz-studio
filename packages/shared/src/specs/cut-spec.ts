// Created by The Angelo Umali.
// cuts/vN.json in object form (plan §7.7). No path fields: media is named by assetId only (plan §6.8).
import { z } from "zod";
import { IdSchema, BaseVideoIdSchema, CANVAS, CanvasPointSchema, CanvasXSchema, CanvasYSchema, FrameRateSchema, sourceSpan } from "../primitives.ts";

/** Mirrors engine edl.py ZOOM_PRESETS. */
export const ZOOM_PRESETS = ["snap", "push", "reveal", "through-out", "through-in", "portal"] as const;
export const CUTAWAY_STYLES = ["wipe", "card"] as const;

const fractionSchema = z.number().min(0).max(1);

export const RemovalSchema = sourceSpan({
  reason: z.string().min(1),
  /** Skip the ±0.15 s snap to an energy minimum. */
  pin: z.boolean().optional(),
  /** A `propose_cuts` candidate id; set_cuts fails unless the user approved it (plan §6.8). */
  fromCandidate: z.string().min(1).optional(),
});

export const TrimPausesSchema = z.strictObject({
  thresholdDb: z.number().max(0),
  minS: z.number().positive(),
  keepS: z.number().nonnegative(),
  exclude: z.array(sourceSpan({})),
});

export const BleepSchema = sourceSpan({ x: CanvasXSchema, y: CanvasYSchema });

export const BlurBoxSchema = sourceSpan({
  x: CanvasXSchema,
  y: CanvasYSchema,
  w: z.number().positive().max(CANVAS.width),
  h: z.number().positive().max(CANVAS.height),
  reason: z.string().min(1),
}).refine((box) => box.x + box.w <= CANVAS.width && box.y + box.h <= CANVAS.height, { message: "blur box must stay on the 1080x1920 grid" });

/** cx/cy are fractions of the frame; the engine defaults them to the punch-in framing. */
export const ZoomSchema = sourceSpan({ preset: z.enum(ZOOM_PRESETS), cx: fractionSchema.optional(), cy: fractionSchema.optional() });

export const PortalSchema = sourceSpan({ corners: z.tuple([CanvasPointSchema, CanvasPointSchema, CanvasPointSchema, CanvasPointSchema]) });

export const CutawaySchema = sourceSpan({ title: z.string().min(1), sub: z.string().optional(), style: z.enum(CUTAWAY_STYLES).optional() });

export const CutSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  sourceAssetId: IdSchema,
  durationS: z.number().positive(),
  fps: FrameRateSchema,
  removals: z.array(RemovalSchema),
  trimPauses: TrimPausesSchema.optional(),
  faceCamRanges: z.array(sourceSpan({})).optional(),
  cutaways: z.array(CutawaySchema).optional(),
  bleeps: z.array(BleepSchema).optional(),
  blurBoxes: z.array(BlurBoxSchema).optional(),
  zooms: z.array(ZoomSchema).optional(),
  portals: z.array(PortalSchema).optional(),
  matteRanges: z.array(sourceSpan({})).optional(),
  /** Set on a derived Reels cut (`v1r`): the full edit it narrows. */
  baseVideoId: BaseVideoIdSchema.optional(),
  isReel: z.boolean().optional(),
});

export type CutSpec = z.infer<typeof CutSpecSchema>;
export type Removal = z.infer<typeof RemovalSchema>;

export interface KeptSpan {
  readonly at: number;
  readonly end: number;
}

/** The source minus the merged removals; the engine's EDL adds pause trimming and frame snapping on top. */
export function keptSpansOf(cuts: Pick<CutSpec, "removals" | "durationS">): KeptSpan[] {
  const removals = [...cuts.removals].sort((first, second) => first.at - second.at);
  const keptSpans: KeptSpan[] = [];
  let cursorS = 0;
  for (const removal of removals) {
    if (removal.at > cursorS) keptSpans.push({ at: cursorS, end: removal.at });
    cursorS = Math.max(cursorS, removal.end);
  }
  if (cuts.durationS > cursorS) keptSpans.push({ at: cursorS, end: cuts.durationS });
  return keptSpans;
}
