ALTER TABLE "organization" ADD COLUMN "video_caption_color" text DEFAULT '#FFFFFF';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "video_caption_font" text DEFAULT 'Inter';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "video_caption_position" text DEFAULT 'bottom';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "video_music_volume" integer DEFAULT 50;