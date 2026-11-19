// Created by The Angelo Umali.
// The /stats page read: every project, job and edit on this machine, from the tables Studio already keeps.
import { z } from "zod";
import { JobStatusSchema, ProjectStatusSchema } from "../enums.ts";
import { IdSchema, IsoTimestampSchema } from "../primitives.ts";

export const STATS_RANGES = ["7d", "30d", "all"] as const;
export const StatsRangeSchema = z.enum(STATS_RANGES);
export type StatsRange = z.infer<typeof StatsRangeSchema>;

/** An ISO-8601 week in UTC, like 2026-W47. */
const IsoWeekSchema = z.string().regex(/^\d{4}-W\d{2}$/);
const CountSchema = z.int().nonnegative();
const SecondsSchema = z.number().nonnegative();

/** Tokens only: Studio keeps no per-edit plan-limit share, and never shows a dollar figure on a subscription. */
export const StatsEditSchema = z.strictObject({
  id: IdSchema,
  projectTitle: z.string(),
  startedAt: IsoTimestampSchema,
  turns: CountSchema,
  tokens: CountSchema.nullable(),
});

export const StatsSchema = z.strictObject({
  range: StatsRangeSchema,
  /** False until the first edit ever, which is the page's empty state. */
  hasAnyEdit: z.boolean(),
  projectsByStatus: z.array(z.strictObject({ status: ProjectStatusSchema, count: CountSchema })),
  jobsByWeek: z.array(z.strictObject({ week: IsoWeekSchema, kind: z.string(), outcome: JobStatusSchema, count: CountSchema })),
  /** Over jobs that finished; null when none did. */
  medianRunS: SecondsSchema.nullable(),
  medianQueueWaitS: SecondsSchema.nullable(),
  /** Finished jobs, newest first. */
  recentJobs: z.array(
    z.strictObject({
      jobId: IdSchema,
      projectTitle: z.string(),
      kind: z.string(),
      outcome: z.enum(["succeeded", "failed"]),
      runS: SecondsSchema,
      error: z.string().nullable(),
      finishedAt: IsoTimestampSchema,
    }),
  ),
  edits: z.array(StatsEditSchema),
  footage: z.strictObject({ keptS: SecondsSchema, sourceS: SecondsSchema }),
  deliverablesByWeek: z.array(z.strictObject({ week: IsoWeekSchema, count: CountSchema })),
});
export type Stats = z.infer<typeof StatsSchema>;
export type StatsEdit = z.infer<typeof StatsEditSchema>;
export type StatsJob = Stats["recentJobs"][number];
