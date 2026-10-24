// Created by The Angelo Umali.
// Render & export screen reads: hardware meters and per-gate QC state (plan §9.1, §7.6).
import { z } from "zod";
import { JobPercentSchema } from "../primitives.ts";
import { RENDER_PROFILES } from "../tools/media.ts";

/** pct is null when the device is not in use for the current render. */
export const HardwareMeterSchema = z.strictObject({ label: z.string().min(1), pct: JobPercentSchema.nullable() });

export const HardwareSchema = z.strictObject({
  profile: z.enum(RENDER_PROFILES),
  encoder: z.string().min(1),
  chunks: z.int().positive(),
  meters: z.array(HardwareMeterSchema),
});

export const QC_CHECK_STATUSES = ["pending", "pass", "fail"] as const;

export const QcCheckSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(QC_CHECK_STATUSES),
  detail: z.string().nullable(),
});

export type Hardware = z.infer<typeof HardwareSchema>;
export type QcCheck = z.infer<typeof QcCheckSchema>;
