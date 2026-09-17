CREATE TYPE "public"."sale_fulfilment_method" AS ENUM('collect', 'ship');--> statement-breakpoint
CREATE TYPE "public"."sale_fulfilment_status" AS ENUM('not_applicable', 'awaiting_collection', 'ready', 'collected', 'dispatched');--> statement-breakpoint
ALTER TYPE "public"."sale_payment_method" ADD VALUE 'online_checkout';--> statement-breakpoint
CREATE TABLE "product_reservation" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"location_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"cart_id" text NOT NULL,
	"stripe_checkout_session_id" text,
	"product_name" text,
	"unit_price_cents" integer,
	"tax_code" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "product_reservation" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_restock_notification" (
	"id" text PRIMARY KEY NOT NULL,
	"product_id" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"notified_at" timestamp,
	CONSTRAINT "product_restock_notification_product_email_unique" UNIQUE("product_id","email")
);
--> statement-breakpoint
ALTER TABLE "product_restock_notification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_preference" ALTER COLUMN "preferences" SET DEFAULT '{"appointments":{"scope":"mine","channels":{"email":true,"push":true}},"inbox":{"scope":"mine","channels":{"email":true,"push":true}},"advertising":{"enabled":true,"channels":{"email":true,"push":true}},"leads":{"scope":"all","channels":{"email":false,"push":true}},"orders":{"scope":"all","channels":{"email":true,"push":true}}}'::jsonb;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "prices_include_vat" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "product" ADD COLUMN "tax_code" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "stripe_tax_calculation_id" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "fulfilment_method" "sale_fulfilment_method";--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "fulfilment_status" "sale_fulfilment_status" DEFAULT 'not_applicable' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "collected_at" timestamp;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "collected_by" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "tracking_reference" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "shop_cart_id" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "shop_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "customer_email" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "order_access_token" text;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "order_confirmed_at" timestamp;--> statement-breakpoint
ALTER TABLE "sale" ADD COLUMN "ready_notification_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "vat_rate_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_item" ADD COLUMN "vat_amount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_reservation" ADD CONSTRAINT "product_reservation_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_reservation" ADD CONSTRAINT "product_reservation_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_restock_notification" ADD CONSTRAINT "product_restock_notification_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_product_reservation_product_location_expiry" ON "product_reservation" USING btree ("product_id","location_id","expires_at");--> statement-breakpoint
CREATE INDEX "idx_product_reservation_cart_id" ON "product_reservation" USING btree ("cart_id");--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_collected_by_user_id_fk" FOREIGN KEY ("collected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sale_org_fulfilment_status" ON "sale" USING btree ("organization_id","fulfilment_status");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_shop_checkout_session_unique" ON "sale" USING btree ("shop_checkout_session_id") WHERE "sale"."shop_checkout_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_order_access_token_unique" ON "sale" USING btree ("order_access_token") WHERE "sale"."order_access_token" is not null;--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "product_reservation" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_reservation.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_reservation.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "product_restock_notification" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_restock_notification.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM product p
    WHERE p.id = product_restock_notification.product_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));