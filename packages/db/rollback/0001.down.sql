-- Created by The Angelo Umali.
-- Reverses 0001_edits_style_reference. Postgres cannot drop an enum value, so asset_kind is rebuilt without
-- 'reference', and reference assets go with it: their files stay on disk, only the rows are removed.
DROP TABLE IF EXISTS "studio"."edits";--> statement-breakpoint
DROP TYPE IF EXISTS "studio"."edit_status";--> statement-breakpoint
ALTER TABLE "studio"."projects" DROP COLUMN IF EXISTS "style";--> statement-breakpoint
DELETE FROM "studio"."media_assets" WHERE "kind" = 'reference';--> statement-breakpoint
ALTER TYPE "studio"."asset_kind" RENAME TO "asset_kind_0001";--> statement-breakpoint
CREATE TYPE "studio"."asset_kind" AS ENUM('camera', 'screen_recording', 'film', 'audio', 'image', 'source', 'proxy', 'wav');--> statement-breakpoint
ALTER TABLE "studio"."media_assets" ALTER COLUMN "kind" TYPE "studio"."asset_kind" USING "kind"::text::"studio"."asset_kind";--> statement-breakpoint
DROP TYPE "studio"."asset_kind_0001";
