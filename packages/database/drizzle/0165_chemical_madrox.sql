CREATE TABLE "product_lot" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"lot" text NOT NULL,
	"expiry" timestamp NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_lot_unique" UNIQUE("product_id","location_id","lot")
);
--> statement-breakpoint
ALTER TABLE "product_lot" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "is_medication" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "online_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "shippable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "product_lot" ADD CONSTRAINT "product_lot_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_lot" ADD CONSTRAINT "product_lot_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_lot_product_id" ON "product_lot" USING btree ("product_id");--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_medication_never_sold" CHECK (NOT ("product"."is_medication" AND ("product"."retail_enabled" OR "product"."online_enabled")));--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_online_implies_retail" CHECK (NOT "product"."online_enabled" OR "product"."retail_enabled");--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "product_lot" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_lot.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_lot.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));