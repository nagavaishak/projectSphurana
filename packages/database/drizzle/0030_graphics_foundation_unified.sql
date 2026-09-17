CREATE TYPE "public"."brand_logo_background_removal_method" AS ENUM('none', 'color_key', 'ai_segmentation', 'manual');--> statement-breakpoint
CREATE TYPE "public"."brand_logo_format" AS ENUM('svg', 'png');--> statement-breakpoint
CREATE TYPE "public"."brand_logo_variant" AS ENUM('primary', 'mono_dark', 'mono_light', 'brand_primary', 'custom');--> statement-breakpoint
CREATE TYPE "public"."brand_font_fallback" AS ENUM('sans-serif', 'serif', 'monospace');--> statement-breakpoint
CREATE TYPE "public"."brand_font_license_type" AS ENUM('google_fonts', 'custom_upload');--> statement-breakpoint
CREATE TYPE "public"."brand_font_role" AS ENUM('heading', 'body', 'display', 'accent');--> statement-breakpoint
CREATE TYPE "public"."brand_font_style" AS ENUM('normal', 'italic');--> statement-breakpoint
CREATE TYPE "public"."graphic_template_density" AS ENUM('text_heavy', 'image_heavy', 'balanced');--> statement-breakpoint
CREATE TYPE "public"."graphic_template_family_role" AS ENUM('instagram_post', 'instagram_story', 'instagram_portrait', 'linkedin_post', 'facebook_post', 'twitter_post', 'tiktok', 'custom');--> statement-breakpoint
CREATE TYPE "public"."content_idea_kind" AS ENUM('offer', 'qa', 'tip', 'storytime', 'informative', 'testimonial', 'credibility', 'hook_claim', 'custom');--> statement-breakpoint
CREATE TYPE "public"."graphic_shadow_render_status" AS ENUM('pending', 'drift', 'acknowledged', 'bug');--> statement-breakpoint
CREATE TYPE "public"."ai_generation_model" AS ENUM('sonnet-4.6', 'opus-4.7');--> statement-breakpoint
CREATE TYPE "public"."graphic_generation_event_status" AS ENUM('success', 'validation_failed', 'rate_limited', 'refused', 'error');--> statement-breakpoint
ALTER TYPE "public"."aspect_ratio" ADD VALUE '1.91:1';--> statement-breakpoint
CREATE TABLE "brand_kit" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"colors" jsonb NOT NULL,
	"typography" jsonb NOT NULL,
	"image_style" jsonb,
	"shapes" jsonb,
	"voice" jsonb,
	"identity" jsonb,
	"music" jsonb,
	"audio_voice" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "brand_kit_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "brand_logo" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_kit_id" text NOT NULL,
	"variant" "brand_logo_variant" NOT NULL,
	"format" "brand_logo_format" NOT NULL,
	"url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"aspect_ratio" numeric NOT NULL,
	"is_auto_generated" boolean DEFAULT false NOT NULL,
	"source_logo_id" text,
	"background_removal_method" "brand_logo_background_removal_method",
	"confidence_score" numeric,
	"is_transparent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_font" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_kit_id" text,
	"family" text NOT NULL,
	"role" "brand_font_role" NOT NULL,
	"weight" integer NOT NULL,
	"style" "brand_font_style" DEFAULT 'normal' NOT NULL,
	"woff2_url" text,
	"ttf_url" text,
	"fallback" "brand_font_fallback" DEFAULT 'sans-serif' NOT NULL,
	"license_type" "brand_font_license_type",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_template_family" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"supported_idea_kinds" text[] DEFAULT '{}' NOT NULL,
	"mood" text[] DEFAULT '{}' NOT NULL,
	"density" "graphic_template_density" DEFAULT 'balanced' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "graphic_template_family_org_slug_unique" UNIQUE("organization_id","slug")
);
--> statement-breakpoint
CREATE TABLE "admin_graphic_template" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"semantic_document" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_content_idea" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_kit_id" text,
	"kind" "content_idea_kind" NOT NULL,
	"title" text NOT NULL,
	"fields" jsonb NOT NULL,
	"offer_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_shadow_render" (
	"id" text PRIMARY KEY NOT NULL,
	"graphic_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"slide_id" text NOT NULL,
	"slide_order" integer NOT NULL,
	"shadow_object_key" text NOT NULL,
	"original_object_key" text NOT NULL,
	"diff_object_key" text,
	"pixel_diff_ratio" numeric(6, 5) NOT NULL,
	"ssim" numeric(6, 5) NOT NULL,
	"matched" boolean NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"status" "graphic_shadow_render_status" DEFAULT 'pending' NOT NULL,
	"triage_notes" text,
	"triaged_at" timestamp,
	"triaged_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graphic_generation_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"brand_kit_id" text NOT NULL,
	"graphic_id" text,
	"content_idea_id" text,
	"template_id" text,
	"status" "graphic_generation_event_status" NOT NULL,
	"model" "ai_generation_model" NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 6) DEFAULT '0' NOT NULL,
	"regeneration_attempt" integer DEFAULT 0 NOT NULL,
	"validation_retries" integer DEFAULT 0 NOT NULL,
	"user_refinement" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "is_mock" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "active_brand_kit_id" text;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "placeholder_contract" jsonb;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "supported_idea_kinds" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "mood" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "density" "graphic_template_density" DEFAULT 'balanced' NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "family_id" text;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "family_role" "graphic_template_family_role";--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "is_ephemeral" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "rendered_url" text;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "ai_eligible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "no_cta" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "embedding_vector" vector(1536);--> statement-breakpoint
ALTER TABLE "graphic_template" ADD COLUMN "embedding_meta_hash" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "semantic_json" jsonb;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "brand_kit_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "content_idea_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "bindings" jsonb;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "generation_context" jsonb;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "family_instance_id" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN "family_role" "graphic_template_family_role";--> statement-breakpoint
ALTER TABLE "brand_kit" ADD CONSTRAINT "brand_kit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_logo" ADD CONSTRAINT "brand_logo_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_logo" ADD CONSTRAINT "brand_logo_source_logo_id_brand_logo_id_fk" FOREIGN KEY ("source_logo_id") REFERENCES "public"."brand_logo"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_font" ADD CONSTRAINT "brand_font_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_template_family" ADD CONSTRAINT "graphic_template_family_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_content_idea" ADD CONSTRAINT "graphic_content_idea_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_content_idea" ADD CONSTRAINT "graphic_content_idea_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_content_idea" ADD CONSTRAINT "graphic_content_idea_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_content_idea" ADD CONSTRAINT "graphic_content_idea_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_shadow_render" ADD CONSTRAINT "graphic_shadow_render_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_shadow_render" ADD CONSTRAINT "graphic_shadow_render_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_shadow_render" ADD CONSTRAINT "graphic_shadow_render_triaged_by_id_user_id_fk" FOREIGN KEY ("triaged_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_content_idea_id_graphic_content_idea_id_fk" FOREIGN KEY ("content_idea_id") REFERENCES "public"."graphic_content_idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic_generation_event" ADD CONSTRAINT "graphic_generation_event_template_id_graphic_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."graphic_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "brand_kit_org_default_unique" ON "brand_kit" USING btree ("organization_id") WHERE is_default = true;--> statement-breakpoint
CREATE INDEX "idx_brand_logo_brand_kit_id" ON "brand_logo" USING btree ("brand_kit_id");--> statement-breakpoint
CREATE INDEX "idx_brand_logo_source_id" ON "brand_logo" USING btree ("source_logo_id");--> statement-breakpoint
CREATE INDEX "idx_brand_font_brand_kit_id" ON "brand_font" USING btree ("brand_kit_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_content_idea_org_id" ON "graphic_content_idea" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_content_idea_brand_kit_id" ON "graphic_content_idea" USING btree ("brand_kit_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_content_idea_kind" ON "graphic_content_idea" USING btree ("kind");--> statement-breakpoint
CREATE INDEX "idx_graphic_content_idea_offer_id" ON "graphic_content_idea" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_shadow_render_status_created_at" ON "graphic_shadow_render" USING btree ("status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_graphic_shadow_render_graphic_slide" ON "graphic_shadow_render" USING btree ("graphic_id","slide_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_graphic_shadow_render_org_status" ON "graphic_shadow_render" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_graphic_generation_event_org_created_at" ON "graphic_generation_event" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_graphic_generation_event_user_created_at" ON "graphic_generation_event" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_graphic_generation_event_graphic_id" ON "graphic_generation_event" USING btree ("graphic_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_generation_event_template_id" ON "graphic_generation_event" USING btree ("template_id");--> statement-breakpoint
ALTER TABLE "graphic_template" ADD CONSTRAINT "graphic_template_family_id_graphic_template_family_id_fk" FOREIGN KEY ("family_id") REFERENCES "public"."graphic_template_family"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_brand_kit_id_brand_kit_id_fk" FOREIGN KEY ("brand_kit_id") REFERENCES "public"."brand_kit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graphic" ADD CONSTRAINT "graphic_content_idea_id_graphic_content_idea_id_fk" FOREIGN KEY ("content_idea_id") REFERENCES "public"."graphic_content_idea"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_graphic_template_embedding_vector" ON "graphic_template" USING hnsw ("embedding_vector" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "idx_graphic_brand_kit_id" ON "graphic" USING btree ("brand_kit_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_content_idea_id" ON "graphic" USING btree ("content_idea_id");--> statement-breakpoint
CREATE INDEX "idx_graphic_family_instance_id" ON "graphic" USING btree ("family_instance_id");