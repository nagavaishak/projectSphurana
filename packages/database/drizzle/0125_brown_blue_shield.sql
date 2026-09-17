ALTER TYPE "public"."appointment_status" ADD VALUE 'held';--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "hold_expiration_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "hold_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_appointment_hold_expires" ON "appointment" USING btree ("hold_expires_at") WHERE "appointment"."hold_expires_at" IS NOT NULL;