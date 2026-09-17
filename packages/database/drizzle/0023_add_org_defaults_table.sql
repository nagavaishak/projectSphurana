CREATE TABLE "org_defaults" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"ad_daily_budget_cents" integer,
	"ad_objective" text,
	"video_orientation" text,
	"video_length_secs" integer,
	"brand_voice" text,
	"default_service_id_for_ads" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "org_defaults" ADD CONSTRAINT "org_defaults_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_defaults" ADD CONSTRAINT "org_defaults_default_service_id_for_ads_organization_service_id_fk" FOREIGN KEY ("default_service_id_for_ads") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;