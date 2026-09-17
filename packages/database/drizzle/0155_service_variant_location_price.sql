CREATE TABLE "organization_service_variant_location" (
	"id" text PRIMARY KEY NOT NULL,
	"variant_id" text NOT NULL,
	"service_id" text NOT NULL,
	"location_id" text NOT NULL,
	"price_cents_override" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_service_variant_location_unique" UNIQUE("variant_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "organization_service_variant_location" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_service_variant_location" ADD CONSTRAINT "organization_service_variant_location_variant_id_organization_service_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."organization_service_variant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_variant_location" ADD CONSTRAINT "organization_service_variant_location_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_variant_location" ADD CONSTRAINT "organization_service_variant_location_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_org_service_variant_location_location_id" ON "organization_service_variant_location" USING btree ("location_id");--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "organization_service_variant_location" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_variant_location.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM organization_service p
    WHERE p.id = organization_service_variant_location.service_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));