// Created by The Angelo Umali.
import { z } from "zod";
import { IdSchema, SourceSecondsSchema } from "../primitives.ts";

/**
 * auto: runs without a card. review: blocks on the user's timeline review (propose_cuts).
 * gate: blocks on an approval card. permission_prompt: the `claude -p` fallback's prompt tool (plan §6.7).
 */
export type ToolApproval = "auto" | "review" | "gate" | "permission_prompt";

export interface StudioToolContract<Input extends z.ZodType = z.ZodType, Output extends z.ZodType = z.ZodType> {
  readonly input: Input;
  /** `structuredContent` of the tool result. */
  readonly output: Output;
  readonly approval: ToolApproval;
  /** Sets the MCP `readOnlyHint`, so Claude may run it in parallel with other reads. */
  readonly isReadOnly: boolean;
}

export function defineTool<Input extends z.ZodType, Output extends z.ZodType>(contract: StudioToolContract<Input, Output>) {
  return contract;
}

/** Long jobs answer at once; Claude follows with job_wait and the UI gets progress events. */
export const JobHandleSchema = z.strictObject({ jobId: IdSchema });

export const EmptyInputSchema = z.strictObject({});

export const TranscriptWordSchema = z.strictObject({ at: SourceSecondsSchema, end: SourceSecondsSchema, text: z.string() });

/** Relative to the project folder; the server never hands an absolute path to the agent. */
export const ProjectPathSchema = z
  .string()
  .min(1)
  .refine((relativePath) => !relativePath.startsWith("/") && !/^[A-Za-z]:/.test(relativePath) && !relativePath.split(/[\\/]/).includes(".."), {
    message: "must be a path relative to the project folder",
  });

export const SpecWriteResultSchema = z.strictObject({ version: z.int().positive(), warnings: z.array(z.string()) });
