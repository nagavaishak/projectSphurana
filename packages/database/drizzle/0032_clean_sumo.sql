ALTER TABLE "content_batch_item" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "scheduled_at" timestamp;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "target_page_ids" jsonb;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "video_idea" jsonb;