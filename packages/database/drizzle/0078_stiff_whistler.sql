CREATE TYPE "public"."onboarding_content_source" AS ENUM('upload', 'stock');--> statement-breakpoint
CREATE TYPE "public"."onboarding_session_status" AS ENUM('active', 'completed', 'abandoned');--> statement-breakpoint
CREATE TABLE "onboarding_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"status" "onboarding_session_status" DEFAULT 'active' NOT NULL,
	"current_slide" text DEFAULT 'intro' NOT NULL,
	"answers" jsonb,
	"conversation_turns" jsonb,
	"website_url" text,
	"analysis_job_id" text,
	"analysis_result" jsonb,
	"content_source" "onboarding_content_source",
	"content_batch_id" text,
	"selected_service_id" text,
	"service_price_cents" integer,
	"offer_id" text,
	"ad_candidate_graphic_ids" jsonb,
	"selected_graphic_ids" jsonb,
	"video_candidate_ids" jsonb,
	"selected_video_id" text,
	"staged_campaign" jsonb,
	"meta_campaign_id" text,
	"launched_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_ads_integration" ADD COLUMN "connection_method" text;--> statement-breakpoint
ALTER TABLE "onboarding_session" ADD CONSTRAINT "onboarding_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_session" ADD CONSTRAINT "onboarding_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_session" ADD CONSTRAINT "onboarding_session_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uniq_onboarding_session_user" ON "onboarding_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_onboarding_session_org_id" ON "onboarding_session" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "user_isolation" ON "onboarding_session" AS PERMISSIVE FOR ALL TO "app_authenticated" USING (user_id = current_setting('app.current_user_id', true)) WITH CHECK (user_id = current_setting('app.current_user_id', true));