-- Carry any CUSTOMISED deposit window over to the org before the column goes.
-- `organization.hold_expiration_hours` (0125) is the single window for both
-- flavours of hold; this one lived on the Stripe integration, so a clinic that
-- had tuned it would silently revert to 24h on the DROP below.
-- Only rows that differ from the default are touched, and only where the org is
-- still on its own default — an explicit org choice wins.
UPDATE "organization" o
SET "hold_expiration_hours" = i."deposit_expiration_hours"
FROM "stripe_connect_integration" i
WHERE i."organization_id" = o."id"
  AND i."deposit_expiration_hours" IS NOT NULL
  AND i."deposit_expiration_hours" <> 24
  AND o."hold_expiration_hours" = 24;--> statement-breakpoint
ALTER TABLE "appointment_deposit" ALTER COLUMN "currency" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" DROP COLUMN "default_deposit_amount_cents";--> statement-breakpoint
ALTER TABLE "stripe_connect_integration" DROP COLUMN "deposit_expiration_hours";
