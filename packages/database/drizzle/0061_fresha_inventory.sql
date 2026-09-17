CREATE TYPE "public"."product_measure_unit" AS ENUM('ml', 'l', 'fl_oz', 'g', 'kg', 'gal', 'oz', 'lb', 'cm', 'ft', 'in', 'whole');--> statement-breakpoint
CREATE TYPE "public"."stock_order_fee_type" AS ENUM('currency', 'percent');--> statement-breakpoint
CREATE TYPE "public"."stock_order_status" AS ENUM('draft', 'ordered', 'partially_received', 'received', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."stock_take_status" AS ENUM('in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TABLE "product" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"images" jsonb,
	"barcode" text,
	"brand_id" text,
	"measure_unit" "product_measure_unit" DEFAULT 'whole' NOT NULL,
	"measure_amount" real,
	"short_description" text,
	"description" text,
	"category_id" text,
	"supply_price_cents" integer,
	"retail_enabled" boolean DEFAULT false NOT NULL,
	"retail_price_cents" integer,
	"team_member_commission_enabled" boolean DEFAULT false NOT NULL,
	"skus" jsonb,
	"supplier_id" text,
	"track_stock" boolean DEFAULT false NOT NULL,
	"low_stock_level" integer,
	"reorder_quantity" integer,
	"low_stock_notify" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_brand" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_brand_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "product_brand" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_category" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_category_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "product_category" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_stock" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "product_stock_unique" UNIQUE("product_id","location_id")
);
--> statement-breakpoint
ALTER TABLE "product_stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_org_name_unique" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "supplier" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_order" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"supplier_id" text,
	"location_id" text,
	"status" "stock_order_status" DEFAULT 'draft' NOT NULL,
	"expected_by_date" timestamp,
	"notes" text,
	"created_by_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_order" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_order_fee" (
	"id" text PRIMARY KEY NOT NULL,
	"stock_order_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "stock_order_fee_type" NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_order_fee" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_order_item" (
	"id" text PRIMARY KEY NOT NULL,
	"stock_order_id" text NOT NULL,
	"product_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"received_quantity" integer DEFAULT 0 NOT NULL,
	"unit_cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_order_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_take" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text,
	"description" text,
	"location_id" text,
	"status" "stock_take_status" DEFAULT 'in_progress' NOT NULL,
	"created_by_id" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_take" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock_take_item" (
	"id" text PRIMARY KEY NOT NULL,
	"stock_take_id" text NOT NULL,
	"product_id" text NOT NULL,
	"expected_quantity" integer NOT NULL,
	"counted_quantity" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stock_take_item_unique" UNIQUE("stock_take_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "stock_take_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_brand_id_product_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."product_brand"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_category_id_product_category_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."product_category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_brand" ADD CONSTRAINT "product_brand_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_category" ADD CONSTRAINT "product_category_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order" ADD CONSTRAINT "stock_order_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order" ADD CONSTRAINT "stock_order_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order" ADD CONSTRAINT "stock_order_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order" ADD CONSTRAINT "stock_order_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order_fee" ADD CONSTRAINT "stock_order_fee_stock_order_id_stock_order_id_fk" FOREIGN KEY ("stock_order_id") REFERENCES "public"."stock_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order_item" ADD CONSTRAINT "stock_order_item_stock_order_id_stock_order_id_fk" FOREIGN KEY ("stock_order_id") REFERENCES "public"."stock_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_order_item" ADD CONSTRAINT "stock_order_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take" ADD CONSTRAINT "stock_take_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take" ADD CONSTRAINT "stock_take_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take" ADD CONSTRAINT "stock_take_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_item" ADD CONSTRAINT "stock_take_item_stock_take_id_stock_take_id_fk" FOREIGN KEY ("stock_take_id") REFERENCES "public"."stock_take"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_take_item" ADD CONSTRAINT "stock_take_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_org_id" ON "product" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_org_barcode_unique" ON "product" USING btree ("organization_id","barcode") WHERE "product"."barcode" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_product_stock_location_id" ON "product_stock" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "idx_stock_order_org_id" ON "stock_order" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_stock_order_item_order_id" ON "stock_order_item" USING btree ("stock_order_id");--> statement-breakpoint
CREATE INDEX "idx_stock_take_org_id" ON "stock_take" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "product" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "product_brand" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "product_category" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "product_stock" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "supplier" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "stock_order" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "stock_order_fee" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "stock_order_item" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_order p
    WHERE p.id = stock_order_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "stock_take" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "stock_take_item" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM stock_take p
    WHERE p.id = stock_take_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM stock_take p
    WHERE p.id = stock_take_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));