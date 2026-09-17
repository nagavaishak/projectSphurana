CREATE TYPE "public"."service_price_type" AS ENUM('fixed', 'from', 'free', 'poa');--> statement-breakpoint
CREATE TABLE "organization_service_variant" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"name" text NOT NULL,
	"price_cents" integer,
	"duration_minutes" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_service_variant_name_unique" UNIQUE("service_id","name")
);
--> statement-breakpoint
ALTER TABLE "organization_service_variant" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "price_type" "service_price_type" DEFAULT 'poa' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service_variant" ADD CONSTRAINT "organization_service_variant_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_organization_service_variant_service_id" ON "organization_service_variant" USING btree ("service_id");--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "organization_service_variant" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_variant.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_variant.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));