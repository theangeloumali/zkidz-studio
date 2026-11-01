CREATE TYPE "studio"."edit_status" AS ENUM('open', 'closed');--> statement-breakpoint
ALTER TYPE "studio"."asset_kind" ADD VALUE 'reference';--> statement-breakpoint
CREATE TABLE "studio"."edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"video_id" text NOT NULL,
	"agent_kind" text NOT NULL,
	"status" "studio"."edit_status" DEFAULT 'open' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"export_job_id" uuid,
	"cost_usd" numeric(12, 6),
	"cost_source" text,
	"input_tokens" bigint,
	"output_tokens" bigint,
	"cache_tokens" bigint,
	"turns" integer DEFAULT 0 NOT NULL,
	"facts" jsonb
);
--> statement-breakpoint
ALTER TABLE "studio"."projects" ADD COLUMN "style" jsonb;--> statement-breakpoint
ALTER TABLE "studio"."edits" ADD CONSTRAINT "edits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "studio"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "studio"."edits" ADD CONSTRAINT "edits_export_job_id_jobs_id_fk" FOREIGN KEY ("export_job_id") REFERENCES "studio"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "edits_project_started_idx" ON "studio"."edits" USING btree ("project_id","started_at");