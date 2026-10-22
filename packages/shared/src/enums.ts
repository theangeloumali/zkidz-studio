// Created by The Angelo Umali.
// One list per domain value set: packages/db builds its Postgres enums from these, so the two cannot drift.
import { z } from "zod";

export const PROJECT_STATUSES = ["draft", "editing", "rendering", "delivered", "archived"] as const;
export const ASSET_KINDS = ["camera", "screen_recording", "film", "audio", "image", "source", "proxy", "wav"] as const;
export const SPEC_KINDS = ["cuts", "reels", "cues", "cues_reel", "cues_cover", "captions", "inserts"] as const;
export const SPEC_AUTHORS = ["agent", "user", "system"] as const;
export const SESSION_STATUSES = ["active", "idle", "interrupted", "errored", "closed"] as const;
/** Mirrors the engine's machine-wide slot locks. */
export const JOB_LANES = ["gpu", "whisper", "overlay", "cpu"] as const;
export const JOB_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled", "interrupted"] as const;
export const DELIVERABLE_KINDS = ["full", "reels", "cover_a", "cover_b", "reels_cover_a", "reels_cover_b", "caption_txt"] as const;
/** Plan §6.2: A = API key, B = cloud provider, T = the user's own `claude` in a terminal. */
export const AUTH_MODES = ["api_key", "cloud", "terminal"] as const;
export const CLOUD_PROVIDERS = ["bedrock", "vertex", "foundry", "anthropicAws"] as const;

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

export type SpecKind = z.infer<typeof SpecKindSchema>;
export type JobStatus = z.infer<typeof JobStatusSchema>;
export type DeliverableKind = z.infer<typeof DeliverableKindSchema>;
export type AuthMode = z.infer<typeof AuthModeSchema>;
