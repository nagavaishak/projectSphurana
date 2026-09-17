CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contractor', 'self_employed', 'intern');--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "phone_country" text;--> statement-breakpoint
ALTER TABLE "invitation" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "last_name" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "phone_secondary" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "phone_country" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "country" "country";--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "date_of_birth" date;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "employment_start_date" date;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "employment_end_date" date;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "employment_type" "employment_type";--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "team_member_ref" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "accepts_bookings" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "languages" text[];--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "social_links" jsonb;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD COLUMN "wage_location_restriction" boolean;--> statement-breakpoint
ALTER TABLE "practitioner_wage_config" ADD COLUMN "location_restriction" "wage_automation_setting" DEFAULT 'workspace_default' NOT NULL;