// Created by The Angelo Umali.
// One list per domain value set: packages/db builds its Postgres enums from these, so the two cannot drift.
import { z } from "zod";

export const PROJECT_STATUSES = ["draft", "editing", "rendering", "delivered", "archived"] as const;
export const ASSET_KINDS = ["camera", "screen_recording", "film", "audio", "image", "source", "proxy", "wav", "reference"] as const;
export const SPEC_KINDS = ["cuts", "reels", "cues", "cues_reel", "cues_cover", "captions", "inserts"] as const;
export const SPEC_AUTHORS = ["agent", "user", "system"] as const;
export const SESSION_STATUSES = ["active", "idle", "interrupted", "errored", "closed"] as const;
/** Mirrors the engine's machine-wide slot locks. */
export const JOB_LANES = ["gpu", "whisper", "overlay", "cpu"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export const DELIVERABLE_KINDS = ["full", "reels", "cover_a", "cover_b", "reels_cover_a", "reels_cover_b", "caption_txt"] as const;
/** Plan §6.2: A = API key, B = cloud provider, T = the user's own `claude` in a terminal. */
export const AUTH_MODES = ["api_key", "cloud", "terminal", "codex_terminal", "opencode_terminal"] as const;
export const CLOUD_PROVIDERS = ["bedrock", "vertex", "foundry", "anthropicAws"] as const;
/** The agent CLIs a terminal session can run. */
export const AGENT_KINDS = ["claude", "codex", "opencode"] as const;
/** Where an edit's cost and token figures came from; every one is an estimate, not billing data. */
export const USAGE_SOURCES = ["sdk", "claude_statusline", "claude_transcript", "codex", "opencode"] as const;
export const EDIT_STATUSES = ["open", "closed"] as const;
/** Theme packs under themes/ that a project may render with (plan §7.8). */
export const THEME_IDS = ["zkidz", "minimal"] as const;

export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export const AssetKindSchema = z.enum(ASSET_KINDS);
export const SpecKindSchema = z.enum(SPEC_KINDS);
export const SpecAuthorSchema = z.enum(SPEC_AUTHORS);
export const SessionStatusSchema = z.enum(SESSION_STATUSES);
export const JobLaneSchema = z.enum(JOB_LANES);
export const JobStatusSchema = z.enum(JOB_STATUSES);
export const DeliverableKindSchema = z.enum(DELIVERABLE_KINDS);
export const AuthModeSchema = z.enum(AUTH_MODES);
export const CloudProviderSchema = z.enum(CLOUD_PROVIDERS);
export const AgentKindSchema = z.enum(AGENT_KINDS);
export const UsageSourceSchema = z.enum(USAGE_SOURCES);
export const EditStatusSchema = z.enum(EDIT_STATUSES);
export const ThemeIdSchema = z.enum(THEME_IDS);

export type SpecKind = z.infer<typeof SpecKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type DeliverableKind = z.infer<typeof DeliverableKindSchema>;
export type AuthMode = z.infer<typeof AuthModeSchema>;
export type AgentKind = z.infer<typeof AgentKindSchema>;
export type UsageSource = z.infer<typeof UsageSourceSchema>;
export type ThemeId = z.infer<typeof ThemeIdSchema>;
