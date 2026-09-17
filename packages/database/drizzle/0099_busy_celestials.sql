CREATE TYPE "public"."stock_clip_source" AS ENUM('shot', 'provider', 'pooled');--> statement-breakpoint
CREATE TYPE "public"."clip_framing" AS ENUM('close_up', 'mid', 'wide');--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "source" "stock_clip_source" DEFAULT 'shot' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "external_asset_id" text;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "acquired_at" timestamp;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "has_identifiable_face" boolean;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "trim_in_ms" integer;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "trim_out_ms" integer;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD COLUMN "framing" "clip_framing";--> statement-breakpoint
CREATE INDEX "idx_stock_clip_source" ON "stock_clip" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_stock_clip_external_asset" ON "stock_clip" USING btree ("external_asset_id") WHERE "stock_clip"."external_asset_id" is not null;--> statement-breakpoint
ALTER TABLE "stock_clip" ADD CONSTRAINT "stock_clip_agent_requires_declarable_source" CHECK ("stock_clip"."agent_slug" is null or "stock_clip"."source" in ('shot', 'pooled'));