ALTER TABLE "brand_media_embedding" ALTER COLUMN "embedding" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "asset_service" ADD COLUMN "depicts_service" boolean;--> statement-breakpoint
ALTER TABLE "asset_service" ADD COLUMN "depicts_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD COLUMN "object_key" text;--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD COLUMN "dhash" text;--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD COLUMN "inspiration_verdict" jsonb;--> statement-breakpoint
ALTER TABLE "brand_media_embedding" ADD COLUMN "gated_at" timestamp;--> statement-breakpoint
CREATE INDEX "idx_brand_media_embedding_org_posted" ON "brand_media_embedding" USING btree ("organization_id","posted_at");