// Created by The Angelo Umali.
// Spec-writing tools: the agent's only write path (plan D4, §6.8).
import { z } from "zod";
import { CutCandidateSchema } from "../events.ts";
import { VideoIdSchema } from "../primitives.ts";
import { CaptionEntrySchema, CaptionPhraseSchema } from "../specs/captions.ts";
import { CueSchema } from "../specs/cues.ts";
import { CutSpecSchema } from "../specs/cut-spec.ts";
import { ReelKeepListSchema } from "../specs/reel-spec.ts";
import { SpecWriteResultSchema, defineTool } from "./define.ts";

export const CUE_SHEETS = ["main", "reel", "cover"] as const;

const CueIdSchema = z.string().min(1);
const CueWriteResultSchema = SpecWriteResultSchema.extend({ id: CueIdSchema });

export const proposeCuts = defineTool({
  input: z.strictObject({ targetS: z.number().positive().optional(), removeFillers: z.boolean().optional(), trimPauses: z.boolean().optional() }),
  output: z.strictObject({ candidates: z.array(CutCandidateSchema), approved: z.array(z.string()), rejected: z.array(z.string()) }),
  approval: "review",
  isReadOnly: false,
});

export const setCuts = defineTool({
  input: z.strictObject({ cuts: CutSpecSchema }),
  output: SpecWriteResultSchema.extend({ segments: z.int().nonnegative(), keptS: z.number().nonnegative() }),
  approval: "auto",
  isReadOnly: false,
});

export const setReel = defineTool({
  input: z.strictObject({ keep: ReelKeepListSchema }),
  output: SpecWriteResultSchema.extend({ reelId: VideoIdSchema, seconds: z.number().positive(), droppedCues: z.array(CueIdSchema) }),
  approval: "auto",
  isReadOnly: false,
});

export const listCueKinds = defineTool({
  input: z.strictObject({ theme: z.string().min(1).optional() }),
  output: z.strictObject({
    kinds: z.array(
      z.strictObject({ kind: z.string(), jsonSchema: z.record(z.string(), z.unknown()), maxChars: z.record(z.string(), z.int().positive()).optional() }),
    ),
  }),
  approval: "auto",
  isReadOnly: true,
});

export const addCue = defineTool({
  input: z.strictObject({ sheet: z.enum(CUE_SHEETS), cue: CueSchema }),
  output: CueWriteResultSchema,
  approval: "auto",
  isReadOnly: false,
});

/** The server merges the patch into the stored cue and re-validates the result against CueSchema. */
export const updateCue = defineTool({
  input: z.strictObject({ id: CueIdSchema, patch: z.record(z.string(), z.unknown()) }),
  output: CueWriteResultSchema,
  approval: "auto",
  isReadOnly: false,
});

export const removeCue = defineTool({
  input: z.strictObject({ id: CueIdSchema }),
  output: CueWriteResultSchema,
  approval: "auto",
  isReadOnly: false,
});

export const makeCaptionPhrases = defineTool({
  input: z.strictObject({ reel: z.boolean().optional() }),
  output: z.strictObject({ phrases: z.array(CaptionPhraseSchema) }),
  approval: "auto",
  isReadOnly: true,
});

export const setCaptions = defineTool({
  input: z.strictObject({ entries: z.array(CaptionEntrySchema).min(1) }),
  output: SpecWriteResultSchema.extend({ cues: z.int().nonnegative() }),
  approval: "auto",
  isReadOnly: false,
});

export const validateSpec = defineTool({
  input: z.strictObject({ videoId: VideoIdSchema }),
  output: z.strictObject({ errors: z.array(z.string()) }),
  approval: "auto",
  isReadOnly: true,
});
