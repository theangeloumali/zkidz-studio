// Created by The Angelo Umali.
// What the REST API returns. Rows map to these at the server boundary; secrets never appear in any of them.
import { z } from "zod";
import {
  AssetKindSchema,
  AuthModeSchema,
  CloudProviderSchema,
  DeliverableKindSchema,
  JobLaneSchema,
  JobStatusSchema,
  ProjectStatusSchema,
  SpecAuthorSchema,
  SpecKindSchema,
} from "../enums.ts";
import { FrameRateSchema, IdSchema, IsoTimestampSchema, JobPercentSchema, VideoIdSchema } from "../primitives.ts";

/** Rules panel cap (plan §6.9). */
export const RULE_TEXT_MAX_CHARS = 500;

export const ProjectSchema = z.strictObject({
  id: IdSchema,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  status: ProjectStatusSchema,
  videoId: VideoIdSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

/** `name` is display text only; the stored file is `<assetId>.<ext>` (plan §9.4). */
export const MediaAssetSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  kind: AssetKindSchema,
  name: z.string(),
  bytes: z.int().nonnegative(),
  isInPlace: z.boolean(),
  durationS: z.number().nonnegative().nullable(),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  fps: FrameRateSchema.nullable(),
  isHdr: z.boolean(),
  createdAt: IsoTimestampSchema,
});

export const SpecSummarySchema = z.strictObject({ videoId: VideoIdSchema, kind: SpecKindSchema, currentVersion: z.int().nonnegative() });

export const SpecVersionSchema = z.strictObject({
  videoId: VideoIdSchema,
  kind: SpecKindSchema,
  version: z.int().positive(),
  author: SpecAuthorSchema,
  note: z.string().nullable(),
  createdAt: IsoTimestampSchema,
  content: z.unknown(),
});

export const JobSchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  kind: z.string().min(1),
  videoId: VideoIdSchema,
  lane: JobLaneSchema,
  status: JobStatusSchema,
  stage: z.string().nullable(),
  pct: JobPercentSchema.nullable(),
  etaS: z.int().nonnegative().nullable(),
  error: z.string().nullable(),
  queuedAt: IsoTimestampSchema,
  startedAt: IsoTimestampSchema.nullable(),
  finishedAt: IsoTimestampSchema.nullable(),
});

export const DeliverableSchema = z.strictObject({
  id: IdSchema,
  kind: DeliverableKindSchema,
  name: z.string(),
  bytes: z.int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: IsoTimestampSchema,
});

export const RuleSchema = z.strictObject({
  id: IdSchema,
  text: z.string().min(1).max(RULE_TEXT_MAX_CHARS),
  sourceQuote: z.string().nullable(),
  isEnabled: z.boolean(),
  createdAt: IsoTimestampSchema,
});

/** The key itself never leaves the server; the UI shows the last 4 (plan §6.5). */
export const ConnectionSchema = z.strictObject({
  mode: AuthModeSchema.nullable(),
  keyLast4: z.string().length(4).nullable(),
  provider: CloudProviderSchema.nullable(),
  claudeVersion: z.string().nullable(),
});

/** Every global setting, typed. proxyOptIn lets HTTPS_PROXY, NO_PROXY and NODE_EXTRA_CA_CERTS reach the agent and the key check (plan §6.5, §6.6). */
export const SettingsSchema = z.strictObject({ proxyOptIn: z.boolean() });
/** Strict, so an unknown key is a 400 rather than a silently stored value. */
export const SettingsUpdateSchema = SettingsSchema.partial();

export const DoctorCheckSchema = z.strictObject({
  id: z.string().min(1),
  label: z.string().min(1),
  status: z.enum(["pass", "warn", "fail"]),
  detail: z.string(),
  fix: z.string().optional(),
});

export type Project = z.infer<typeof ProjectSchema>;
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type Job = z.infer<typeof JobSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
