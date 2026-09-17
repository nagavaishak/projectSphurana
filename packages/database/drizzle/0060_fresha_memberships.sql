CREATE TYPE "public"."lead_membership_status" AS ENUM('active', 'past_due', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."membership_pricing_type" AS ENUM('one_time', 'recurring');--> statement-breakpoint
CREATE TYPE "public"."membership_valid_for" AS ENUM('7d', '14d', '1m', '2m', '3m', '4m', '6m', '8m', '1y', '18m', '2y', '3y', '5y');--> statement-breakpoint
CREATE TABLE "lead_membership" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"sessions_remaining" integer,
	"valid_until" timestamp,
	"stripe_subscription_id" text,
	"status" "lead_membership_status" DEFAULT 'active' NOT NULL,
	"sale_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lead_membership" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"session_count" integer,
	"pricing_type" "membership_pricing_type" DEFAULT 'one_time' NOT NULL,
	"valid_for" "membership_valid_for" DEFAULT '1m' NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"stripe_product_id" text,
	"stripe_price_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "membership_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_plan_service" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_service_unique" UNIQUE("plan_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "membership_plan_service" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead_membership" ADD CONSTRAINT "lead_membership_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_membership" ADD CONSTRAINT "lead_membership_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_membership" ADD CONSTRAINT "lead_membership_plan_id_membership_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan" ADD CONSTRAINT "membership_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_service" ADD CONSTRAINT "membership_plan_service_plan_id_membership_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_service" ADD CONSTRAINT "membership_plan_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_membership_org_id" ON "lead_membership" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_lead_membership_lead_id" ON "lead_membership" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_membership_plan_service_service_id" ON "membership_plan_service" USING btree ("service_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "lead_membership" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "membership_plan" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "membership_plan_service" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));