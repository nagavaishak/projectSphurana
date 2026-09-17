ALTER TABLE "image_render_request" ADD COLUMN "image_url" text;--> statement-breakpoint
ALTER TABLE "image_render_request" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "image_render_request" DROP COLUMN "clean_image_url";--> statement-breakpoint
ALTER TABLE "image_render_request" DROP COLUMN "bordered_image_url";