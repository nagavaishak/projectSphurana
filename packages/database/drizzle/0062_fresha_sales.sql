CREATE TYPE "public"."sale_item_type" AS ENUM('appointment', 'service', 'product', 'membership', 'gift_card');--> statement-breakpoint
CREATE TYPE "public"."sale_payment_method" AS ENUM('cash', 'card_terminal', 'qr_self_checkout', 'manual_card', 'gift_card');--> statement-breakpoint
CREATE TYPE "public"."sale_payment_status" AS ENUM('pending', 'succeeded', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('open', 'completed', 'refunded', 'partially_refunded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."sale_tip_type" AS ENUM('none', 'percent', 'amount');--> statement-breakpoint
CREATE TYPE "public"."gift_card_transaction_type" AS ENUM('issue', 'redeem', 'adjust');--> statement-breakpoint
CREATE TABLE "sale" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text,
	"location_id" text,
	"status" "sale_status" DEFAULT 'open' NOT NULL,
	"subtotal_cents" integer DEFAULT 0 NOT NULL,
	"tip_type" "sale_tip_type" DEFAULT 'none' NOT NULL,
	"tip_percent" real,
	"tip_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"created_by_id" text NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_item" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"item_type" "sale_item_type" NOT NULL,
	"appointment_id" text,
	"service_id" text,
	"product_id" text,
	"membership_plan_id" text,
	"gift_card_id" text,
	"practitioner_id" text,
	"name" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_item" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"method" "sale_payment_method" NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" "sale_payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"gift_card_id" text,
	"reader_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_payment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gift_card" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"code" text NOT NULL,
	"initial_amount_cents" integer NOT NULL,
	"balance_cents" integer NOT NULL,
	"currency" text DEFAULT 'eur' NOT NULL,
	"expires_at" timestamp,
	"lead_id" text,
	"sale_item_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "gift_card_org_code_unique" UNIQUE("organization_id","code")
);
--> statement-breakpoint
ALTER TABLE "gift_card" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "gift_card_transaction" (
	"id" text PRIMARY KEY NOT NULL,
	"gift_card_id" text NOT NULL,
	"type" "gift_card_transaction_type" NOT NULL,
	"amount_cents" integer NOT NULL,
	"sale_id" text,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gift_card_transaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DEFAULT 'booked'::text;--> statement-breakpoint
UPDATE "appointment" SET "status" = 'booked' WHERE "status" = 'scheduled';--> statement-breakpoint
UPDATE "appointment" SET "status" = 'cancelled' WHERE "status" = 'deposit_expired';--> statement-breakpoint
DROP TYPE "public"."appointment_status";--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('booked', 'confirmed', 'arrived', 'started', 'completed', 'no_show', 'cancelled');--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DEFAULT 'booked'::"public"."appointment_status";--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "status" SET DATA TYPE "public"."appointment_status" USING "status"::"public"."appointment_status";--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" ADD COLUMN "account_type" text DEFAULT 'standard_oauth' NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" ADD COLUMN "requirements_currently_due" jsonb;--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" ADD COLUMN "disabled_reason" text;--> statement-breakpoint
ALTER TABLE "organization_location" ADD COLUMN "stripe_terminal_location_id" text;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_location_id_organization_location_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."organization_location"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale" ADD CONSTRAINT "sale_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_membership_plan_id_membership_plan_id_fk" FOREIGN KEY ("membership_plan_id") REFERENCES "public"."membership_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_gift_card_id_gift_card_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_card"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_item" ADD CONSTRAINT "sale_item_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payment" ADD CONSTRAINT "sale_payment_gift_card_id_gift_card_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_card"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card" ADD CONSTRAINT "gift_card_sale_item_id_sale_item_id_fk" FOREIGN KEY ("sale_item_id") REFERENCES "public"."sale_item"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transaction" ADD CONSTRAINT "gift_card_transaction_gift_card_id_gift_card_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_card"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transaction" ADD CONSTRAINT "gift_card_transaction_sale_id_sale_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sale"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transaction" ADD CONSTRAINT "gift_card_transaction_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_sale_org_id" ON "sale" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_sale_lead_id" ON "sale" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_sale_org_created_at" ON "sale" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_sale_item_sale_id" ON "sale_item" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "idx_sale_payment_sale_id" ON "sale_payment" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "idx_gift_card_lead_id" ON "gift_card" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_gift_card_transaction_gift_card_id" ON "gift_card_transaction" USING btree ("gift_card_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "sale" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "sale_item" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "sale_payment" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM sale p
    WHERE p.id = sale_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "gift_card" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "gift_card_transaction" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM gift_card p
    WHERE p.id = gift_card_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM gift_card p
    WHERE p.id = gift_card_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));