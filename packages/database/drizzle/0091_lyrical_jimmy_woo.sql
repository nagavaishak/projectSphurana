-- IF NOT EXISTS is deliberate. This migration is main's 0059_perfect_celestials
-- regenerated onto this branch's chain after the merge (byte-identical SQL). PROD
-- already applied main's 0059, so `graphic.error_code`/`error_message` exist
-- there; a bare ADD COLUMN would fail "column already exists" on the prod deploy.
-- On a fresh DB (CI/dev) the columns don't exist and this creates them. Idempotent
-- either way.
ALTER TABLE "graphic" ADD COLUMN IF NOT EXISTS "error_code" text;--> statement-breakpoint
ALTER TABLE "graphic" ADD COLUMN IF NOT EXISTS "error_message" text;
