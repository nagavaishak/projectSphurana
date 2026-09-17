CREATE TYPE "public"."provenance_logo_outcome" AS ENUM('used', 'missing-no-logo', 'missing-fetch-failed', 'not-applicable');--> statement-breakpoint
CREATE TYPE "public"."provenance_media_source" AS ENUM('service-video-thumbnail', 'service-image-asset', 'owner-selected', 'stock', 'ai-generated', 'none');--> statement-breakpoint
CREATE TYPE "public"."provenance_subject" AS ENUM('graphic', 'video');--> statement-breakpoint
CREATE TABLE "content_generation_provenance" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_type" "provenance_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"batch_id" text,
	"batch_item_id" text,
	"service_id" text,
	"chosen_asset_id" text,
	"media_source" "provenance_media_source" NOT NULL,
	"logo_outcome" "provenance_logo_outcome" DEFAULT 'not-applicable' NOT NULL,
	"candidates_considered" text[],
	"rejected_candidates" jsonb,
	"template_slug" text,
	"model" text,
	"detail" jsonb,
	"organization_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_generation_provenance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP INDEX "uniq_content_batch_org_month";--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "rendered_copy" text;--> statement-breakpoint
ALTER TABLE "asset_service" ADD COLUMN "last_used_at" timestamp;--> statement-breakpoint
ALTER TABLE "asset_service" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_generation_provenance" ADD CONSTRAINT "content_generation_provenance_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generation_provenance" ADD CONSTRAINT "content_generation_provenance_chosen_asset_id_asset_id_fk" FOREIGN KEY ("chosen_asset_id") REFERENCES "public"."asset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generation_provenance" ADD CONSTRAINT "content_generation_provenance_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cgp_org_service_created_idx" ON "content_generation_provenance" USING btree ("organization_id","service_id","created_at");--> statement-breakpoint
CREATE INDEX "cgp_subject_idx" ON "content_generation_provenance" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cgp_org_created_idx" ON "content_generation_provenance" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_asset_service_rotation" ON "asset_service" USING btree ("service_id","last_used_at");--> statement-breakpoint
CREATE INDEX "idx_content_batch_org_created" ON "content_batch" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "content_generation_provenance" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));