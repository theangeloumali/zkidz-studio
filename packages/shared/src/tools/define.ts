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

// Windows opens a device for these names whatever the folder or extension (CON, nul.mp4, LPT9.txt).
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

// Windows drops a trailing dot or space, so `a.` and `a ` alias `a`; this also rejects `.` and `..`.
function isSafePathSegment(segment: string): boolean {
  return segment !== "" && !segment.endsWith(".") && !segment.endsWith(" ") && !WINDOWS_RESERVED_NAME.test(segment);
}

// A leading separator covers POSIX roots, UNC, device and root-relative paths; any colon covers drives and ADS (plan §9.4).
function isProjectRelativePath(candidatePath: string): boolean {
  if (/^[\\/]/.test(candidatePath) || /[:\0]/.test(candidatePath)) return false;
  return candidatePath.split(/[\\/]/).every(isSafePathSegment);
}

/** Relative to the project folder; the server never hands an absolute path to the agent. */
export const ProjectPathSchema = z.string().min(1).refine(isProjectRelativePath, { message: "must be a path relative to the project folder" });

export const SpecWriteResultSchema = z.strictObject({ version: z.int().positive(), warnings: z.array(z.string()) });
