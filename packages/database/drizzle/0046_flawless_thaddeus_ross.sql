ALTER TABLE "image_template" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "image_render_batch" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "image_render_request" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "image_template" CASCADE;--> statement-breakpoint
DROP TABLE "image_render_batch" CASCADE;--> statement-breakpoint
DROP TABLE "image_render_request" CASCADE;--> statement-breakpoint
ALTER TABLE "graphic" DROP CONSTRAINT IF EXISTS "graphic_image_template_id_image_template_id_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "idx_graphic_image_template_id";--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "topic_summary" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "kind" text DEFAULT 'single' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_graphic_service_id" ON "graphic" USING btree ("service_id");--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "image_template_id";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "fabric_scene";--> statement-breakpoint
DROP TYPE "public"."graphic_category";--> statement-breakpoint
DROP TYPE "public"."image_template_kind";--> statement-breakpoint
DROP TYPE "public"."image_render_batch_status";