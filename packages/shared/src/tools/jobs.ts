// Created by The Angelo Umali.
// Job polling and the `claude -p` fallback's permission prompt tool (plan §6.7, §6.8).
import { z } from "zod";
import { JobStatusSchema } from "../enums.ts";
import { IdSchema, JobPercentSchema } from "../primitives.ts";
import { defineTool } from "./define.ts";

/** One call blocks at most this long, so a tool call never holds the turn for minutes. */
export const MAX_JOB_WAIT_S = 120;

const JobInputSchema = z.strictObject({ jobId: IdSchema });

/** `result` holds the job kind's result (IngestResultSchema, MasterRenderResultSchema, ...) once it succeeded. */
export const JobSnapshotSchema = z.strictObject({
  jobId: IdSchema,
  status: JobStatusSchema,
  stage: z.string().optional(),
  pct: JobPercentSchema.optional(),
  etaS: z.number().nonnegative().optional(),
  logTail: z.array(z.string()),
  result: z.unknown().optional(),
});

export const jobStatus = defineTool({ input: JobInputSchema, output: JobSnapshotSchema, approval: "auto", isReadOnly: true });

export const jobWait = defineTool({
  input: JobInputSchema.extend({ timeoutS: z.int().positive().max(MAX_JOB_WAIT_S) }),
  output: JobSnapshotSchema,
  approval: "auto",
  isReadOnly: true,
});

export const jobCancel = defineTool({ input: JobInputSchema, output: z.strictObject({ ok: z.literal(true) }), approval: "auto", isReadOnly: false });

/** Requeues an interrupted job with the params it was approved with, so it needs no second approval. */
export const jobResume = defineTool({ input: JobInputSchema, output: z.strictObject({ ok: z.literal(true) }), approval: "auto", isReadOnly: false });

export const approve = defineTool({
  input: z.strictObject({ tool: z.string().min(1), input: z.unknown() }),
  output: z.discriminatedUnion("behavior", [
    z.strictObject({ behavior: z.literal("allow"), updatedInput: z.record(z.string(), z.unknown()).optional() }),
    z.strictObject({ behavior: z.literal("deny"), message: z.string().min(1) }),
  ]),
  approval: "permission_prompt",
  isReadOnly: false,
});
