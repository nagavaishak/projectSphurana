CREATE TYPE "public"."graphic_category" AS ENUM('tips', 'motivation', 'question', 'storyline');--> statement-breakpoint
CREATE TYPE "public"."image_template_kind" AS ENUM('carousel', 'single');--> statement-breakpoint
CREATE TYPE "public"."image_render_batch_status" AS ENUM('submitted', 'running', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TABLE "image_template" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"kind" "image_template_kind" NOT NULL,
	"category" "graphic_category" DEFAULT 'tips' NOT NULL,
	"slide_count" integer NOT NULL,
	"reference_image_urls" jsonb NOT NULL,
	"slot_map" jsonb NOT NULL,
	"fabric_scenes" jsonb,
	"border_width_px" integer DEFAULT 12 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"import_prompt" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "image_template_slug_unique" UNIQUE("slug"),
	CONSTRAINT "image_template_slide_count_range" CHECK ("image_template"."slide_count" >= 1 AND "image_template"."slide_count" <= 10)
);
--> statement-breakpoint
CREATE TABLE "image_render_batch" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"content_batch_id" text,
	"provider_batch_id" text NOT NULL,
	"status" "image_render_batch_status" DEFAULT 'submitted' NOT NULL,
	"submitted_at" timestamp,
	"completed_at" timestamp,
	"request_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "image_render_request" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"template_id" text NOT NULL,
	"slide_index" integer NOT NULL,
	"graphic_id" text,
	"slot_fills" jsonb NOT NULL,
	"clean_image_url" text,
	"bordered_image_url" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graphic_template_family" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graphic_template" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graphic_content_idea" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graphic_shadow_render" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canva_integration" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "canva_plugin_api_key" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "graphic_template_family" CASCADE;--> statement-breakpoint
DROP TABLE "graphic_template" CASCADE;--> statement-breakpoint
DROP TABLE "graphic_content_idea" CASCADE;--> statement-breakpoint
DROP TABLE "graphic_shadow_render" CASCADE;--> statement-breakpoint
DROP TABLE "graphic_generation_event" CASCADE;--> statement-breakpoint
DROP TABLE "canva_integration" CASCADE;--> statement-breakpoint
DROP TABLE "canva_plugin_api_key" CASCADE;--> statement-breakpoint
ALTER TABLE "graphic" DROP CONSTRAINT IF EXISTS "graphic_template_id_graphic_template_id_fk";
--> statement-breakpoint
ALTER TABLE "graphic" DROP CONSTRAINT IF EXISTS "graphic_content_idea_id_graphic_content_idea_id_fk";
--> statement-breakpoint
DROP INDEX "idx_graphic_template_id";--> statement-breakpoint
DROP INDEX "idx_graphic_content_idea_id";--> statement-breakpoint
DROP INDEX "idx_graphic_family_instance_id";--> statement-breakpoint
ALTER TABLE "graphic" ALTER COLUMN "aspect_ratio" SET DEFAULT '4:5';--> statement-breakpoint
ALTER TABLE "graphic" ALTER COLUMN "canvas_height" SET DEFAULT 1350;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "image_template_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "fabric_scene" jsonb;--> statement-breakpoint
ALTER TABLE "image_render_batch" ADD CONSTRAINT "image_render_batch_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_render_batch" ADD CONSTRAINT "image_render_batch_content_batch_id_content_batch_id_fk" FOREIGN KEY ("content_batch_id") REFERENCES "public"."content_batch"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_render_request" ADD CONSTRAINT "image_render_request_batch_id_image_render_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."image_render_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_render_request" ADD CONSTRAINT "image_render_request_template_id_image_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."image_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_render_request" ADD CONSTRAINT "image_render_request_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_image_template_kind" ON "image_template" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_image_template_active" ON "image_template" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_image_template_category" ON "image_template" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_image_template_kind_category" ON "image_template" USING btree ("kind","category");--> statement-breakpoint
CREATE INDEX "idx_image_render_batch_org_id" ON "image_render_batch" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_batch_content_batch_id" ON "image_render_batch" USING btree ("content_batch_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_batch_provider_id" ON "image_render_batch" USING btree ("provider_batch_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_batch_status" ON "image_render_batch" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_image_render_request_batch_id" ON "image_render_request" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_request_template_id" ON "image_render_request" USING btree ("template_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_request_graphic_id" ON "image_render_request" USING btree ("graphic_id");--> statement-breakpoint
CREATE INDEX "idx_image_render_request_batch_slide" ON "image_render_request" USING btree ("batch_id","slide_index");--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_image_template_id_image_template_id_fk" FOREIGN KEY ("image_template_id") REFERENCES "public"."image_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_graphic_image_template_id" ON "graphic" USING btree ("image_template_id");--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "template_id";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "slides";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "semantic_json";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "content_idea_id";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "bindings";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "generation_context";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "family_instance_id";--> statement-breakpoint
ALTER TABLE "graphic" DROP COLUMN "family_role";--> statement-breakpoint
DROP TYPE "public"."graphic_template_density";--> statement-breakpoint
DROP TYPE "public"."graphic_template_family_role";--> statement-breakpoint
DROP TYPE "public"."graphic_template_category";--> statement-breakpoint
DROP TYPE "public"."content_idea_kind";--> statement-breakpoint
DROP TYPE "public"."graphic_shadow_render_status";--> statement-breakpoint
DROP TYPE "public"."ai_generation_model";--> statement-breakpoint
DROP TYPE "public"."graphic_generation_event_status";