ALTER TABLE "content_batch_item" ADD COLUMN "pending_video_edits" jsonb;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "edit_render_count" integer DEFAULT 0 NOT NULL;