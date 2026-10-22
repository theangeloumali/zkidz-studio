// Created by The Angelo Umali.
// reels/vN.json: the source ranges the Reels cut keeps.
import { z } from "zod";
import { BaseVideoIdSchema, sourceSpan } from "../primitives.ts";

export const ReelKeepSchema = sourceSpan({ pin: z.boolean().optional() });

/** make_reels.py walks keeps in source order; an overlap would repeat footage. */
function isInSourceOrder(keeps: readonly { at: number; end: number }[]): boolean {
  return keeps.every((keep, index) => index === 0 || keep.at >= (keeps[index - 1]?.end ?? 0));
}

/** Shared by ReelSpecSchema and the set_reel tool, so the tool cannot accept what the spec rejects. */
export const ReelKeepListSchema = z.array(ReelKeepSchema).min(1).refine(isInSourceOrder, { message: "keeps must be in source order and must not overlap" });

export const ReelSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseVideoId: BaseVideoIdSchema,
  keep: ReelKeepListSchema,
});

export type ReelSpec = z.infer<typeof ReelSpecSchema>;
export type ReelKeep = z.infer<typeof ReelKeepSchema>;
