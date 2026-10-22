CREATE SCHEMA "studio";
--> statement-breakpoint
CREATE TYPE "studio"."asset_kind" AS ENUM('camera', 'screen_recording', 'film', 'audio', 'image', 'source', 'proxy', 'wav');--> statement-breakpoint
CREATE TYPE "studio"."deliverable_kind" AS ENUM('full', 'reels', 'cover_a', 'cover_b', 'reels_cover_a', 'reels_cover_b', 'caption_txt');--> statement-breakpoint
CREATE TYPE "studio"."job_lane" AS ENUM('gpu', 'whisper', 'overlay', 'cpu');--> statement-breakpoint
CREATE TYPE "studio"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted');--> statement-breakpoint
CREATE TYPE "studio"."project_status" AS ENUM('draft', 'editing', 'rendering', 'delivered', 'archived');--> statement-breakpoint
CREATE TYPE "studio"."session_status" AS ENUM('active', 'idle', 'interrupted', 'errored', 'closed');--> statement-breakpoint
CREATE TYPE "studio"."spec_author" AS ENUM('agent', 'user', 'system');--> statement-breakpoint
CREATE TYPE "studio"."spec_kind" AS ENUM('cuts', 'reels', 'cues', 'cues_reel', 'cues_cover', 'captions', 'inserts');--> statement-breakpoint
CREATE TABLE "studio"."agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"sdk_session_id" text,
	"forked_from_id" uuid,
	"status" "studio"."session_status" DEFAULT 'active' NOT NULL,
	"model" text,
	"auth_mode" text NOT NULL,
	"num_turns" integer DEFAULT 0 NOT NULL,
	"total_cost_usd" numeric(12, 6),
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "agent_sessions_sdk_session_id_unique" UNIQUE("sdk_session_id")
);
--> statement-breakpoint
CREATE TABLE "studio"."deliverables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" "studio"."deliverable_kind" NOT NULL,
	"rel_path" text NOT NULL,
	"bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"width" integer,
	"height" integer,
	"duration_s" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."edit_spec_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spec_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"sha256" text NOT NULL,
	"content" text NOT NULL,
	"author" "studio"."spec_author" NOT NULL,
	"session_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."edit_specs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"kind" "studio"."spec_kind" NOT NULL,
	"rel_path" text NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "studio"."events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"project_id" uuid NOT NULL,
	"session_id" uuid,
	"job_id" uuid,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"video_id" text NOT NULL,
	"lane" "studio"."job_lane" NOT NULL,
	"status" "studio"."job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"depends_on" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"spec_snapshot_sha256" text,
	"stage" text,
	"pct" real,
	"eta_s" integer,
	"pid" integer,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error" text,
	"log_rel_path" text,
	"requested_by_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "studio"."media_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "studio"."asset_kind" NOT NULL,
	"name" text NOT NULL,
	"rel_path" text,
	"in_place_path" text,
	"bytes" bigint NOT NULL,
	"mtime_ms" bigint NOT NULL,
	"duration_s" real,
	"width" integer,
	"height" integer,
	"fps_num" integer,
	"fps_den" integer,
	"is_hdr" boolean DEFAULT false NOT NULL,
	"probe" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_assets_one_location" CHECK (("studio"."media_assets"."rel_path" is null) <> ("studio"."media_assets"."in_place_path" is null))
);
--> statement-breakpoint
CREATE TABLE "studio"."projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"status" "studio"."project_status" DEFAULT 'draft' NOT NULL,
	"video_id" text DEFAULT 'v1' NOT NULL,
	"current_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "studio"."providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mode" text NOT NULL,
	"label" text NOT NULL,
	"key_last4" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"source_quote" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "rules_text_length" CHECK (char_length("studio"."rules"."text") <= 500)
);
--> statement-breakpoint
CREATE TABLE "studio"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio"."transcripts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"model" text NOT NULL,
	"language" text NOT NULL,
	"words_rel_path" text NOT NULL,
	"word_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "studio"."agent_sessions" ADD CONSTRAINT "agent_sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."deliverables" ADD CONSTRAINT "deliverables_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."deliverables" ADD CONSTRAINT "deliverables_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "studio"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."edit_spec_versions" ADD CONSTRAINT "edit_spec_versions_spec_id_edit_specs_id_fk" FOREIGN KEY ("spec_id") REFERENCES "studio"."edit_specs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."edit_spec_versions" ADD CONSTRAINT "edit_spec_versions_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "studio"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."edit_specs" ADD CONSTRAINT "edit_specs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."events" ADD CONSTRAINT "events_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "studio"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."events" ADD CONSTRAINT "events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "studio"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."jobs" ADD CONSTRAINT "jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."jobs" ADD CONSTRAINT "jobs_requested_by_session_id_agent_sessions_id_fk" FOREIGN KEY ("requested_by_session_id") REFERENCES "studio"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."media_assets" ADD CONSTRAINT "media_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."projects" ADD CONSTRAINT "projects_current_session_id_agent_sessions_id_fk" FOREIGN KEY ("current_session_id") REFERENCES "studio"."agent_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."transcripts" ADD CONSTRAINT "transcripts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."transcripts" ADD CONSTRAINT "transcripts_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "studio"."media_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edit_spec_versions_spec_version_uq" ON "studio"."edit_spec_versions" USING btree ("spec_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "edit_specs_project_video_kind_uq" ON "studio"."edit_specs" USING btree ("project_id","video_id","kind");--> statement-breakpoint
CREATE INDEX "events_project_id_idx" ON "studio"."events" USING btree ("project_id","id");--> statement-breakpoint
CREATE INDEX "jobs_runnable_idx" ON "studio"."jobs" USING btree ("status","lane","priority","created_at");--> statement-breakpoint
CREATE INDEX "jobs_project_idx" ON "studio"."jobs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "media_assets_project_rel_path_uq" ON "studio"."media_assets" USING btree ("project_id","rel_path");