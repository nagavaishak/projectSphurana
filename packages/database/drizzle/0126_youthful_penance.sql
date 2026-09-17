CREATE TYPE "public"."deposit_aggregation" AS ENUM('largest', 'sum');--> statement-breakpoint
CREATE TYPE "public"."deposit_basis" AS ENUM('fixed', 'percent');--> statement-breakpoint
CREATE TYPE "public"."service_payment_policy" AS ENUM('in_clinic', 'deposit', 'full');--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_payment_policy" "service_payment_policy" DEFAULT 'in_clinic' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_deposit_basis" "deposit_basis" DEFAULT 'fixed' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_deposit_percent" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deposit_aggregation" "deposit_aggregation" DEFAULT 'sum' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "payment_policy" "service_payment_policy";--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "deposit_basis" "deposit_basis";--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "deposit_percent" integer;