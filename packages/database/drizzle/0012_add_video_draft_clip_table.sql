CREATE TYPE "public"."video_draft_clip_processing_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."video_draft_clip_source" AS ENUM('uploaded', 'library', 'suggested');--> statement-breakpoint
CREATE TABLE "video_draft_clip" (
	"id" text PRIMARY KEY NOT NULL,
	"video_id" text NOT NULL,
	"asset_id" text,
	"source" "video_draft_clip_source" NOT NULL,
	"beat_order" integer DEFAULT 0 NOT NULL,
	"processing_status" "video_draft_clip_processing_status" DEFAULT 'processing' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video_draft_clip" ADD CONSTRAINT "video_draft_clip_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_draft_clip" ADD CONSTRAINT "video_draft_clip_asset_id_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_video_draft_clip_video_id" ON "video_draft_clip" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "idx_video_draft_clip_asset_id" ON "video_draft_clip" USING btree ("asset_id");