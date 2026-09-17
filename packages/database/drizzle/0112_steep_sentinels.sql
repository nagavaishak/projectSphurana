ALTER TABLE "content_batch_item" ADD COLUMN "pending_regenerate" jsonb;--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "pending_regenerate_note";