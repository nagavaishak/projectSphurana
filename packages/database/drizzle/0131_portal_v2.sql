-- Portal v2 (hand-edited preamble): patient_auth / patient_session /
-- patient_account_token may contain QA-seed rows in preview DBs but hold ZERO
-- real data. The NOT NULL customer_account_id columns added below would fail
-- on non-empty tables, so wipe the throwaway QA rows first (children before
-- parent, explicitly). Leads and consent submissions are NOT touched.
-- Guarded (ENG-647 review). These three DELETEs are unconditional and the
-- justification above — "ZERO real data" — is true only because 0130 and 0131
-- ship in the same release. If 0130 is ever cherry-picked, hot-fixed ahead, or
-- a rebase reorders the pair, this silently destroys real portal memberships
-- and cascades their tokens and sessions. Refuse instead of shredding: a
-- migration that aborts is recoverable, a migration that deleted the wrong
-- rows is not. The threshold is deliberately generous — QA seeds are a
-- handful of rows, a live clinic's portal is not.
DO $$
DECLARE membership_count integer;
BEGIN
  SELECT count(*) INTO membership_count FROM "patient_auth";
  IF membership_count > 50 THEN
    RAISE EXCEPTION
      'Refusing to wipe % patient_auth rows — this migration assumes QA-only data. If these are real memberships, 0130 has been applied out of order with 0131.',
      membership_count;
  END IF;
END
$$;--> statement-breakpoint
DELETE FROM "patient_session";--> statement-breakpoint
DELETE FROM "patient_account_token";--> statement-breakpoint
DELETE FROM "patient_auth";--> statement-breakpoint
ALTER TYPE "public"."patient_account_token_purpose" ADD VALUE 'otp';--> statement-breakpoint
ALTER TYPE "public"."patient_account_token_purpose" ADD VALUE 'magic_link';--> statement-breakpoint
CREATE TABLE "customer_account" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"last_login_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_account_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "customer_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_session" DROP CONSTRAINT "patient_session_patient_auth_id_patient_auth_id_fk";
--> statement-breakpoint
DROP INDEX "idx_patient_session_auth_id";--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "customer_cancellations_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "cancellation_notice_required_hours" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_account_token" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_auth" ADD COLUMN "customer_account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "customer_account_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD COLUMN "signature_image_key" text;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD COLUMN "pdf_key" text;--> statement-breakpoint
ALTER TABLE "patient_auth" ADD CONSTRAINT "patient_auth_customer_account_id_customer_account_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_session" ADD CONSTRAINT "patient_session_customer_account_id_customer_account_id_fk" FOREIGN KEY ("customer_account_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_patient_session_customer_account_id" ON "patient_session" USING btree ("customer_account_id");--> statement-breakpoint
ALTER TABLE "patient_auth" DROP COLUMN "password_hash";--> statement-breakpoint
ALTER TABLE "patient_auth" DROP COLUMN "password_set_at";--> statement-breakpoint
-- Policy references patient_auth_id, so it must go BEFORE the column drop —
-- a fresh replay fails with "other objects depend on it" in the generated order.
DROP POLICY "child_org_isolation" ON "patient_session" CASCADE;--> statement-breakpoint
ALTER TABLE "patient_session" DROP COLUMN "patient_auth_id";