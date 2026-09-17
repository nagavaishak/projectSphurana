ALTER TABLE "organization" DROP COLUMN "deposit_link";--> statement-breakpoint
ALTER TABLE "organization_service" DROP COLUMN "deposit_link";--> statement-breakpoint
ALTER TABLE "organization_service" DROP COLUMN "stripe_payment_link_id";--> statement-breakpoint
ALTER TABLE "organization_service" DROP COLUMN "stripe_product_id";--> statement-breakpoint
ALTER TABLE "organization_package" DROP COLUMN "deposit_link";--> statement-breakpoint
ALTER TABLE "organization_package" DROP COLUMN "stripe_payment_link_id";--> statement-breakpoint
ALTER TABLE "organization_package" DROP COLUMN "stripe_product_id";