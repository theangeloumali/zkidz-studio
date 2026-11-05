// Created by The Angelo Umali.
// cuts/vN.json in object form (plan §7.7). No path fields: media is named by assetId only (plan §6.8).
import { z } from "zod";
import {
  IdSchema,
  BaseVideoIdSchema,
  CANVAS,
  CanvasPointSchema,
  CanvasXSchema,
  CanvasYSchema,
  FractionSchema,
  FrameRateSchema,
  sourceSpan,
} from "../primitives.ts";

/** Mirrors engine edl.py ZOOM_PRESETS. */
export const ZOOM_PRESETS = ["snap", "push", "reveal", "through-out", "through-in", "portal", "lean"] as const;
/** Mirrors backends/graph.py GRADES; "learning" is the v2 Live Motion look. */
export const GRADES = ["house", "learning"] as const;
/** Mirrors music_bed.py KINDS. */
export const MUSIC_SECTION_KINDS = ["cold", "intro", "chapter", "outro"] as const;
export const CUTAWAY_STYLES = ["wipe", "card"] as const;

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
export const ZoomSchema = sourceSpan({ preset: z.enum(ZOOM_PRESETS), cx: FractionSchema.optional(), cy: FractionSchema.optional() });

/** Rack focus: the room blurs behind him by `amount` px (CUDA path only). */
export const FocusSchema = sourceSpan({ amount: z.number().min(1).max(40) });

/** A 9:16 slice of a wider source's picture band, centred on cx/cy and zoomed by `scale`, so square footage fills the frame. */
export const ReframeSchema = sourceSpan({ cx: FractionSchema, cy: FractionSchema.optional(), scale: z.number().min(1).max(3).optional() });

/** An original music bed for the edit, written under his voice; sections are on the source clock. */
export const MusicBedSchema = z
  .strictObject({
    bpm: z.number().min(40).max(200).optional(),
    sections: z.array(z.strictObject({ at: z.number().finite().nonnegative(), kind: z.enum(MUSIC_SECTION_KINDS), energy: FractionSchema.optional() })).min(1),
    /** dB under his speech level (default 20); lower it on a mostly muted montage. */
    under: z.number().min(6).max(40).optional(),
    /** dB more while he talks (default 8). */
    duck: z.number().min(0).max(20).optional(),
  })
  .refine((bed) => bed.sections[0]?.at === 0 && bed.sections.every((section, index, all) => index === 0 || section.at > (all[index - 1]?.at ?? 0)), {
    message: "music sections start at 0 and strictly increase",
  });

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
  focus: z.array(FocusSchema).optional(),
  grade: z.enum(GRADES).optional(),
  reframes: z.array(ReframeSchema).optional(),
  /** Every kept second without a reframe is framed on whoever is speaking (#45). */
  follow: z.literal("speaker").optional(),
  /** The creator's answer: blur every face but theirs ("others"), or none (#44). */
  blurFaces: z.enum(["others", "none"]).optional(),
  /** Places the footage visits that its own GPS cannot prove; the map gate wants each one pinned (v2 rule 8). */
  places: z.array(z.strictObject({ name: z.string().min(1), lon: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })).optional(),
  music: MusicBedSchema.optional(),
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
