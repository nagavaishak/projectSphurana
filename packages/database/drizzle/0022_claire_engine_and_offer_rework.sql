CREATE TYPE "public"."offer_discount_type" AS ENUM('percentage', 'fixed_price', 'buy_x_get_y');--> statement-breakpoint
CREATE TYPE "public"."offer_state" AS ENUM('draft', 'active', 'paused', 'expired');--> statement-breakpoint
CREATE TYPE "public"."business_vertical" AS ENUM('aesthetic_clinic', 'hair_salon', 'beauty_salon', 'fitness', 'dental', 'legal');--> statement-breakpoint
CREATE TYPE "public"."commitment_level" AS ENUM('impulse', 'planned', 'major');--> statement-breakpoint
CREATE TYPE "public"."market_position" AS ENUM('below', 'at', 'above', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."offer_strategy" AS ENUM('price_visible_intro', 'switch_service', 'price_hidden_conversation', 'consultation_led', 'do_not_advertise');--> statement-breakpoint
CREATE TYPE "public"."retention_model" AS ENUM('course_based', 'rebooking', 'consideration_sale');--> statement-breakpoint
ALTER TYPE "public"."assistant_recommendation_kind" ADD VALUE 'ad_flow_service_pick';--> statement-breakpoint
ALTER TYPE "public"."assistant_recommendation_kind" ADD VALUE 'ad_flow_offer_pick';--> statement-breakpoint
ALTER TYPE "public"."assistant_recommendation_kind" ADD VALUE 'classifier_disagreement';--> statement-breakpoint
CREATE TABLE "offer_location" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"location_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "offer_location_unique" UNIQUE("offer_id","location_id")
);
--> statement-breakpoint
CREATE TABLE "business_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"vertical" "business_vertical" NOT NULL,
	"retention_model" "retention_model" NOT NULL,
	"commitment_level" "commitment_level" NOT NULL,
	"market_position" "market_position" DEFAULT 'unknown' NOT NULL,
	"axes_confidence" numeric,
	"axes_reasoning" text,
	"classifier_axes" jsonb,
	"overridden_axes" jsonb,
	"disagreement" jsonb,
	"ranked_services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_hash" text NOT NULL,
	"classified_at" timestamp DEFAULT now() NOT NULL,
	"classifier_version" text NOT NULL,
	"vertical_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "business_profile_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
DROP INDEX "idx_offer_is_active";--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "state" "offer_state" DEFAULT 'active' NOT NULL;--> statement-breakpoint
-- discount_type is added nullable so existing rows are backfilled below
-- before the NOT NULL constraint is enforced.
ALTER TABLE "offer" ADD COLUMN "discount_type" "offer_discount_type";--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "limit_per_client" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "redemption_limit" integer;--> statement-breakpoint
-- HAND-WRITTEN BACKFILL: preserve discriminator + lifecycle data before
-- dropping the legacy `type` and `is_active` columns.
UPDATE "offer" SET "discount_type" = CASE
	WHEN "type" = 'price_discount'      THEN 'fixed_price'::offer_discount_type
	WHEN "type" = 'percentage_discount' THEN 'percentage'::offer_discount_type
	WHEN "type" = 'buy_x_get_y'         THEN 'buy_x_get_y'::offer_discount_type
END;--> statement-breakpoint
UPDATE "offer" SET "state" = CASE
	WHEN "is_active" = true  THEN 'active'::offer_state
	WHEN "is_active" = false THEN 'paused'::offer_state
END;--> statement-breakpoint
ALTER TABLE "offer" ALTER COLUMN "discount_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "offer_location" ADD CONSTRAINT "offer_location_offer_id_offer_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offer"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_location" ADD CONSTRAINT "offer_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "business_profile" ADD CONSTRAINT "business_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_offer_location_location_id" ON "offer_location" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_offer_state" ON "offer" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_offer_org_code_unique" ON "offer" USING btree ("organization_id",lower("code")) WHERE "offer"."code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "headline";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "description";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "type";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "bullet_points";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "cta_text";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "urgency_text";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "audience_text";--> statement-breakpoint
ALTER TABLE "offer" DROP COLUMN "is_active";--> statement-breakpoint
DROP TYPE "public"."offer_type";
