// Created by The Angelo Umali.
// reels/vN.json: the source ranges the Reels cut keeps.
import { z } from "zod";
import { BaseVideoIdSchema, sourceSpan } from "../primitives.ts";

export const ReelKeepSchema = sourceSpan({ pin: z.boolean().optional() });

/** make_reels.py walks keeps in source order; an overlap would repeat footage. */
function isInSourceOrder(keeps: readonly { at: number; end: number }[]): boolean {
  return keeps.every((keep, index) => index === 0 || keep.at >= (keeps[index - 1]?.end ?? 0));
}

export const ReelSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  baseVideoId: BaseVideoIdSchema,
  keep: z.array(ReelKeepSchema).min(1).refine(isInSourceOrder, { message: "keeps must be in source order and must not overlap" }),
});

export type ReelSpec = z.infer<typeof ReelSpecSchema>;
export type ReelKeep = z.infer<typeof ReelKeepSchema>;
