ALTER TYPE "public"."offer_discount_type" ADD VALUE 'fixed_amount' BEFORE 'fixed_price';--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "discount_amount_cents" integer;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "redemption_count" integer DEFAULT 0 NOT NULL;