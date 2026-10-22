// Created by The Angelo Umali.
// One Drizzle pg-core schema for PGlite and Supabase Postgres 17 (plan D1, §8). PG <= 17 features only; no RLS, no auth.users.
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgSchema,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  ASSET_KINDS,
  DELIVERABLE_KINDS,
  JOB_LANES,
  JOB_STATUSES,
  PROJECT_STATUSES,
  RULE_TEXT_MAX_CHARS,
  SESSION_STATUSES,
  SPEC_AUTHORS,
  SPEC_KINDS,
} from "@zks/shared";

/** Never `public`: keeps every table off Supabase's Data API. */
export const studio = pgSchema("studio");

// One timestamp mode everywhere: Date objects, serialised to ISO strings at the API boundary.
const timestampColumn = (columnName: string) => timestamp(columnName, { withTimezone: true, mode: "date" });
const createdAt = () => timestampColumn("created_at").notNull().defaultNow();
const projectIdColumn = () =>
  uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" });

export const projectStatus = studio.enum("project_status", PROJECT_STATUSES);
export const assetKind = studio.enum("asset_kind", ASSET_KINDS);
export const specKind = studio.enum("spec_kind", SPEC_KINDS);
export const specAuthor = studio.enum("spec_author", SPEC_AUTHORS);
export const sessionStatus = studio.enum("session_status", SESSION_STATUSES);
export const jobLane = studio.enum("job_lane", JOB_LANES);
export const jobStatus = studio.enum("job_status", JOB_STATUSES);
export const deliverableKind = studio.enum("deliverable_kind", DELIVERABLE_KINDS);

export const projects = studio.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(), // folder name under ZKS_HOME/projects
  title: text("title").notNull(),
  status: projectStatus("status").notNull().default("draft"),
  videoId: text("video_id").notNull().default("v1"),
  currentSessionId: uuid("current_session_id").references((): AnyPgColumn => agentSessions.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
});

export const agentSessions = studio.table("agent_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: projectIdColumn(),
  sdkSessionId: text("sdk_session_id").unique(), // resume key; mode T's --session-id
  forkedFromId: uuid("forked_from_id"),
  status: sessionStatus("status").notNull().default("active"),
  model: text("model"),
  authMode: text("auth_mode").notNull(), // AUTH_MODES, validated by zod; never the credential
  numTurns: integer("num_turns").notNull().default(0),
  totalCostUsd: numeric("total_cost_usd", { precision: 12, scale: 6 }), // latest result, not a sum: resume includes prior spend
  usage: jsonb("usage").$type<Record<string, unknown>>(),
  startedAt: createdAt(),
  endedAt: timestampColumn("ended_at"),
});

export const mediaAssets = studio.table(
  "media_assets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: projectIdColumn(),
    kind: assetKind("kind").notNull(),
    name: text("name").notNull(), // the original filename, display text only
    relPath: text("rel_path"), // uploads: <assetId>.<ext> under the project folder
    inPlacePath: text("in_place_path"), // a registered single file's realpath (plan §9.4)
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    mtimeMs: bigint("mtime_ms", { mode: "number" }).notNull(), // size + mtime detect a replaced file without hashing 100 GB
    durationS: real("duration_s"),
    width: integer("width"),
    height: integer("height"),
    fpsNum: integer("fps_num"),
    fpsDen: integer("fps_den"),
    isHdr: boolean("is_hdr").notNull().default(false),
    probe: jsonb("probe").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("media_assets_project_rel_path_uq").on(table.projectId, table.relPath),
    check("media_assets_one_location", sql`(${table.relPath} is null) <> (${table.inPlacePath} is null)`),
  ],
);

export const transcripts = studio.table("transcripts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: projectIdColumn(),
  mediaAssetId: uuid("media_asset_id")
    .notNull()
    .references(() => mediaAssets.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  language: text("language").notNull(),
  wordsRelPath: text("words_rel_path").notNull(),
  wordCount: integer("word_count").notNull(),
  createdAt: createdAt(),
});

export const editSpecs = studio.table(
  "edit_specs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: projectIdColumn(),
    videoId: text("video_id").notNull(),
    kind: specKind("kind").notNull(),
    relPath: text("rel_path").notNull(),
    currentVersion: integer("current_version").notNull().default(0),
  },
  (table) => [uniqueIndex("edit_specs_project_video_kind_uq").on(table.projectId, table.videoId, table.kind)],
);

export const editSpecVersions = studio.table(
  "edit_spec_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    specId: uuid("spec_id")
      .notNull()
      .references(() => editSpecs.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sha256: text("sha256").notNull(), // an unchanged hash skips the insert
    content: text("content").notNull(), // KB-scale spec JSON; restore writes it back and bumps current_version
    author: specAuthor("author").notNull(),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("edit_spec_versions_spec_version_uq").on(table.specId, table.version)],
);

export const jobs = studio.table(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: projectIdColumn(),
    kind: text("kind").notNull(), // grows often, so text validated by zod rather than an enum
    videoId: text("video_id").notNull(),
    lane: jobLane("lane").notNull(),
    status: jobStatus("status").notNull().default("queued"),
    priority: integer("priority").notNull().default(0),
    dependsOn: uuid("depends_on")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    specSnapshotSha256: text("spec_snapshot_sha256"), // renders the spec set as it was at job start (plan §7.6)
    stage: text("stage"),
    pct: real("pct"), // 0..100 like JobPercentSchema, written at most once a second
    etaS: integer("eta_s"),
    pid: integer("pid"),
    attempt: integer("attempt").notNull().default(0),
    error: text("error"), // user-safe; full stderr stays in the log file
    logRelPath: text("log_rel_path"),
    requestedBySessionId: uuid("requested_by_session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    queuedAt: createdAt(),
    startedAt: timestampColumn("started_at"),
    finishedAt: timestampColumn("finished_at"),
  },
  (table) => [
    index("jobs_runnable_idx").on(table.status, table.lane, table.priority, table.queuedAt),
    index("jobs_project_idx").on(table.projectId, table.queuedAt),
  ],
);

export const deliverables = studio.table("deliverables", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: projectIdColumn(),
  jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
  kind: deliverableKind("kind").notNull(),
  relPath: text("rel_path").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull(),
  sha256: text("sha256").notNull(),
  width: integer("width"),
  height: integer("height"),
  durationS: real("duration_s"),
  createdAt: createdAt(),
});

export const events = studio.table(
  "events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(), // the SSE `id:` cursor
    projectId: projectIdColumn(),
    sessionId: uuid("session_id").references(() => agentSessions.id, { onDelete: "set null" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    type: text("type").notNull(), // StudioEventType
    payload: jsonb("payload").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("events_project_id_idx").on(table.projectId, table.id)],
);

export const providers = studio.table("providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  mode: text("mode").notNull(), // AUTH_MODES
  label: text("label").notNull(),
  keyLast4: text("key_last4"), // display only; the key lives in the OS keychain or a 0600 file
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: createdAt(),
});

export const settings = studio.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
});

/** Created only by an explicit user click; agent output never becomes a rule (plan §6.9). */
export const rules = studio.table(
  "rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    sourceQuote: text("source_quote"),
    createdAt: createdAt(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [check("rules_text_length", sql`char_length(${table.text}) <= ${sql.raw(String(RULE_TEXT_MAX_CHARS))}`)],
);
