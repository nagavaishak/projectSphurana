CREATE TABLE "organization_service_location" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"location_id" text NOT NULL,
	"price_cents_override" integer,
	"duration_minutes_override" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_service_location_unique" UNIQUE("service_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "organization_service_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "membership_plan_location" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"location_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "membership_plan_location_unique" UNIQUE("plan_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "membership_plan_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_location" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_location_unique" UNIQUE("product_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "product_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "primary_location_id" text;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "blocked_time" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "time_off" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "organization_service_location" ADD CONSTRAINT "organization_service_location_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_location" ADD CONSTRAINT "organization_service_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_location" ADD CONSTRAINT "membership_plan_location_plan_id_membership_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."membership_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_plan_location" ADD CONSTRAINT "membership_plan_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_location" ADD CONSTRAINT "product_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organization_service_location_location_id" ON "organization_service_location" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_membership_plan_location_location_id" ON "membership_plan_location" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_product_location_location_id" ON "product_location" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_primary_location_id_organization_location_id_fk" FOREIGN KEY ("primary_location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_time" ADD CONSTRAINT "blocked_time_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_off" ADD CONSTRAINT "time_off_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_org_primary_location" ON "lead" USING btree ("organization_id","primary_location_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_location_id" ON "appointment" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_org_location_start" ON "appointment" USING btree ("organization_id","location_id","start_date") WHERE "appointment"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_blocked_time_location_id" ON "blocked_time" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_time_off_location_id" ON "time_off" USING btree ("location_id");--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "organization_service_location" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_location.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_location.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "membership_plan_location" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = membership_plan_location.plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM membership_plan p
    WHERE p.id = membership_plan_location.plan_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "product_location" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_location.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_location.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));