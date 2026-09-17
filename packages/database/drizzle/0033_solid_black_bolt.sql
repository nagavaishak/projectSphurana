ALTER TABLE "graphic_template" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "source_url" text;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "source_page" integer;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "source_format" text;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "source_version" integer DEFAULT 1 NOT NULL;