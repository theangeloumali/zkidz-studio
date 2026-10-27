// Created by The Angelo Umali.
import { z } from "zod";

/** The v1 portrait canvas; every on-screen coordinate is authored on this grid (plan §3.3). */
export const CANVAS = { width: 1080, height: 1920 } as const;

export const IdSchema = z.uuid();
export const IsoTimestampSchema = z.iso.datetime({ offset: true });

/** Engine video id: `v1` for the full edit, `v1r` for its Reels cut. */
export const VideoIdSchema = z.string().regex(/^v[0-9]+r?$/, "video id looks like v1 or v1r");
export const BaseVideoIdSchema = z.string().regex(/^v[0-9]+$/, "base video id looks like v1");

/** Seconds on the source footage's clock; the EDL maps them to edited time. */
export const SourceSecondsSchema = z.number().finite().nonnegative();

/** A word pin: source seconds after the owning cue's `at`, so it stays on its word across trimmed pauses. */
export const PinSecondsSchema = z.number().finite().nonnegative();

/** Job progress, 0..100 everywhere: events, job snapshots, the REST DTO and the `jobs.pct` column. */
export const JobPercentSchema = z.number().min(0).max(100);

/** Kept as a rational: 30000/1001 vs 29.97 decides frame identity. */
export const FrameRateSchema = z.strictObject({ num: z.int().positive(), den: z.int().positive() });

export const CanvasXSchema = z.number().min(0).max(CANVAS.width);
export const CanvasYSchema = z.number().min(0).max(CANVAS.height);
export const CanvasPointSchema = z.strictObject({ x: CanvasXSchema, y: CanvasYSchema });

const spanOrderMessage = { message: "end must be after at", path: ["end"] };

// Takes unknown because zod's output type for a generic shape does not expose `at`/`end` to the compiler.
function endsAfterStart(span: unknown): boolean {
  if (typeof span !== "object" || span === null || !("at" in span) || !("end" in span)) return false;
  return typeof span.at === "number" && typeof span.end === "number" && span.end > span.at;
}

/** A strict `{at, end, ...fields}` object in source seconds whose end is after its start. */
export function sourceSpan<Fields extends z.ZodRawShape>(fields: Fields) {
  return z.strictObject({ at: SourceSecondsSchema, end: SourceSecondsSchema, ...fields }).refine(endsAfterStart, spanOrderMessage);
}

export const SourceSpanSchema = sourceSpan({});
export type SourceSpan = z.infer<typeof SourceSpanSchema>;
