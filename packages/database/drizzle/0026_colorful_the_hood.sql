CREATE TYPE "public"."video_usage_type" AS ENUM('ad', 'organic');--> statement-breakpoint
CREATE TYPE "public"."graphic_usage_type" AS ENUM('ad', 'organic');--> statement-breakpoint
CREATE TYPE "public"."content_batch_item_kind" AS ENUM('video', 'graphic');--> statement-breakpoint
CREATE TYPE "public"."content_batch_item_review_status" AS ENUM('pending', 'accepted', 'regenerated', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."content_batch_status" AS ENUM('planning', 'generating', 'review', 'scheduling', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "content_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"period_month" text NOT NULL,
	"status" "content_batch_status" DEFAULT 'planning' NOT NULL,
	"error_message" text,
	"finalise_at" timestamp,
	"reviewed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_batch_item" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"kind" "content_batch_item_kind" NOT NULL,
	"video_id" text,
	"graphic_id" text,
	"review_status" "content_batch_item_review_status" DEFAULT 'pending' NOT NULL,
	"position" integer NOT NULL,
	"regeneration_count" integer DEFAULT 0 NOT NULL,
	"previous_item_id" text,
	"regeneration_reason" text,
	"scheduled_social_post_id" text,
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "usage_type" "video_usage_type" DEFAULT 'ad' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "usage_type" "graphic_usage_type" DEFAULT 'ad' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "usage_type" "graphic_usage_type" DEFAULT 'ad' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch" ADD CONSTRAINT "content_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD CONSTRAINT "content_batch_item_batch_id_content_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."content_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD CONSTRAINT "content_batch_item_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD CONSTRAINT "content_batch_item_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_batch_org_id" ON "content_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_content_batch_org_month" ON "content_batch" USING btree ("organization_id","period_month");--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_batch_id" ON "content_batch_item" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_batch_kind_position" ON "content_batch_item" USING btree ("batch_id","kind","position");--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_previous" ON "content_batch_item" USING btree ("previous_item_id");--> statement-breakpoint
CREATE INDEX "idx_video_org_usage_type" ON "video" USING btree ("organization_id","usage_type");--> statement-breakpoint
CREATE INDEX "idx_graphic_org_usage_type" ON "graphic" USING btree ("organization_id","usage_type");
