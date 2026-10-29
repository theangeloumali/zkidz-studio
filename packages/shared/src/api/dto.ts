// Created by The Angelo Umali.
// What the REST API returns. Rows map to these at the server boundary; secrets never appear in any of them.
import { z } from "zod";
import {
  AgentKindSchema,
  AssetKindSchema,
  AuthModeSchema,
  CloudProviderSchema,
  DeliverableKindSchema,
  EditStatusSchema,
  JobLaneSchema,
  JobStatusSchema,
  ProjectStatusSchema,
  SpecAuthorSchema,
  SpecKindSchema,
  ThemeIdSchema,
  UsageSourceSchema,
} from "../enums.ts";
import { SFX_LEVELS } from "../presets.ts";
import { FrameRateSchema, IdSchema, IsoTimestampSchema, JobPercentSchema, VideoIdSchema } from "../primitives.ts";

/** Rules panel cap (plan §6.9). */
export const RULE_TEXT_MAX_CHARS = 500;
/** A title comes from a dropped file name, and file names stop at 255 on every desktop filesystem. */
export const PROJECT_TITLE_MAX_CHARS = 255;
/** Every enabled rule joins every system prompt, so their number is capped too. */
export const RULES_ENABLED_MAX = 50;

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

/** What an edit did, written once when it closes; the next edits read the recent ones (plan 2026-10-29, slice E). */
export const EditFactsSchema = z.strictObject({
  sourceS: z.number().nonnegative().optional(),
  keptS: z.number().nonnegative().optional(),
  segments: z.int().nonnegative().optional(),
  cutReasons: z.array(z.string()),
  opening: z.string().optional(),
  /** Question text → the user's answer, from that edit's question cards. */
  answers: z.record(z.string(), z.string()),
});

/** One edit: from the first prompt with no open edit to the export that closes it. Cost and tokens are estimates. */
export const EditSummarySchema = z.strictObject({
  id: IdSchema,
  projectId: IdSchema,
  videoId: VideoIdSchema,
  agentKind: AgentKindSchema,
  status: EditStatusSchema,
  startedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
  costUsd: z.number().nonnegative().nullable(),
  costSource: UsageSourceSchema.nullable(),
  inputTokens: z.int().nonnegative().nullable(),
  outputTokens: z.int().nonnegative().nullable(),
  cacheTokens: z.int().nonnegative().nullable(),
  turns: z.int().nonnegative(),
  facts: EditFactsSchema.nullable(),
});

/** themes/<id>/theme.json type roles, and the faces packages/engine/hf/brand/fonts.js bundles (plan §7.8). */
export const THEME_TYPE_ROLES = ["display", "body", "label", "kicker", "hand", "mono"] as const;
export const BUNDLED_FONT_FAMILIES = ["Newsreader", "Inter", "Caveat", "JetBrains Mono"] as const;
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * A project's look over its theme pack. Token names must exist in that theme's tokens (the server checks against
 * theme.json); components always come from the repo, so a style can change colours and faces but never code.
 */
export const ProjectStyleSchema = z.strictObject({
  theme: ThemeIdSchema,
  tokens: z.record(z.string().regex(/^[a-z][A-Za-z0-9]*$/), HexColorSchema).optional(),
  type: z.partialRecord(z.enum(THEME_TYPE_ROLES), z.enum(BUNDLED_FONT_FAMILIES)).optional(),
  boil: z.boolean().optional(),
  sfx: z.enum(SFX_LEVELS).optional(),
  /** Target average shot length in seconds, from a reference's pace. */
  shotLengthS: z.number().min(0.5).max(30).optional(),
  /** Where the style came from, shown in the Style panel. */
  referenceAssetId: IdSchema.optional(),
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

/** Codes a client branches on instead of the status; append-only, because old clients match on these strings. */
export const ApiErrorCodeSchema = z.enum(["key_rejected"]);
/** Every API failure body. */
export const ApiErrorBodySchema = z.strictObject({ error: z.string(), code: ApiErrorCodeSchema.optional() });

export type Project = z.infer<typeof ProjectSchema>;
export type MediaAsset = z.infer<typeof MediaAssetSchema>;
export type Job = z.infer<typeof JobSchema>;
export type Rule = z.infer<typeof RuleSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type EditSummary = z.infer<typeof EditSummarySchema>;
export type EditFacts = z.infer<typeof EditFactsSchema>;
export type ProjectStyle = z.infer<typeof ProjectStyleSchema>;
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

export const PROJECT_MAX_TURNS_CAP = 200;
export const PROJECT_BUDGET_USD_CAP = 100;
/** Per-project agent limits: maxTurns in modes A and B, budgetUsd in mode A only (plan §6.6). */
export const ProjectSettingsSchema = z.strictObject({
  maxTurns: z.int().min(1).max(PROJECT_MAX_TURNS_CAP),
  budgetUsd: z.number().positive().max(PROJECT_BUDGET_USD_CAP),
});
export const ProjectSettingsUpdateSchema = ProjectSettingsSchema.partial();
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
/** The house styles the onboarding cards offer (plan §9.1, `/setup/style`). */
export const StyleIdSchema = z.enum(["zkidz", "plain", "loud"]);
export const StyleChoiceSchema = z.strictObject({ styleId: StyleIdSchema });
export type StyleId = z.infer<typeof StyleIdSchema>;

export const SpecVersionSummarySchema = SpecVersionSchema.omit({ content: true });

/** The player's map from edited time to source time, from the current cuts spec (plan §9.3). */
export const PlayerEdlSchema = z.strictObject({
  videoId: VideoIdSchema,
  cutsVersion: z.int().positive(),
  durationS: z.number().positive(),
  keptS: z.number().nonnegative(),
  segments: z.array(z.strictObject({ sourceAtS: z.number().nonnegative(), sourceEndS: z.number().positive(), editedAtS: z.number().nonnegative() })),
  // The last built composition, so a page opened after its preview.ready still shows the overlay.
  preview: z.strictObject({ compositionUrl: z.url(), edlVersion: z.int().positive() }).nullable(),
});
export type SpecSummary = z.infer<typeof SpecSummarySchema>;
export type SpecVersion = z.infer<typeof SpecVersionSchema>;
export type SpecVersionSummary = z.infer<typeof SpecVersionSummarySchema>;
export type PlayerEdl = z.infer<typeof PlayerEdlSchema>;
