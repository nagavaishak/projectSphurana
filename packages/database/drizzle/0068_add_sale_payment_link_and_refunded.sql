ALTER TABLE "sale_payment" ADD COLUMN "stripe_payment_link_id" text;--> statement-breakpoint
ALTER TABLE "sale_payment" ADD COLUMN "refunded_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sale_payment_stripe_pi" ON "sale_payment" USING btree ("stripe_payment_intent_id") WHERE "sale_payment"."stripe_payment_intent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_time_entry_open_per_practitioner" ON "time_entry" USING btree ("practitioner_id") WHERE "time_entry"."clock_out" IS NULL;