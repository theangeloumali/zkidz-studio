// Created by The Angelo Umali.
// The fields every cue kind shares, so the house and learning-vlog kinds build on one helper.
import { z } from "zod";
import { sourceSpan } from "../primitives.ts";

export const textSchema = z.string().min(1);
export const optionalTextSchema = z.string().optional();

/** "behind" draws in a second pass under the person matte, so he stands in front of it. */
export const CUE_DEPTHS = ["front", "behind"] as const;

/** The transcript word a cue lands on; Phase 3 checks `at` sits within -0.2..+1.8 s of it (plan §7.7). */
export const CueAnchorSchema = z.strictObject({ phrase: textSchema, wordIndex: z.int().nonnegative() });

export function cueKind<Kind extends string, Fields extends z.ZodRawShape>(kind: Kind, fields: Fields) {
  return learningCueKind(kind, { depth: z.enum(CUE_DEPTHS).optional(), ...fields });
}

/** A learning-vlog kind has no depth: v2 rule 5 keeps every word in front of the person (#43). */
export function learningCueKind<Kind extends string, Fields extends z.ZodRawShape>(kind: Kind, fields: Fields) {
  return sourceSpan({ kind: z.literal(kind), id: z.string().min(1).optional(), anchor: CueAnchorSchema.optional(), ...fields });
}

/** A project-relative image path; build.js resolves it inside the project or a registered in-place file. */
export const ProjectImagePathSchema = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith("/") && !/^[A-Za-z]:/.test(path) && !path.split(/[\\/]/).includes(".."), {
    message: "src must be a project-relative path",
  });

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "a #rrggbb colour");
