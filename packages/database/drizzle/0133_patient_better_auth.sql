-- Hand-edited preamble (ENG-647 review), same reasoning as 0131's.
--
-- Further down this migration adds `patient_session.token` and
-- `patient_session.user_id` as NOT NULL with NO DEFAULT. On an EMPTY table
-- that is fine, which is why a fresh database migrates cleanly and the
-- migration-smoke job never saw a problem. On any database where 0131/0132
-- already applied and someone has since signed in to the portal — the shared
-- preview DB and staging both qualify — those statements abort with "column
-- contains null values" and take the whole deploy down with them.
--
-- Wiping the rows is not a loss: this migration REPLACES the session store,
-- dropping `token_hash` and `customer_account_id` and handing ownership to
-- Better Auth. Every pre-existing row is unusable the moment it lands. The
-- cut-over therefore signs out any signed-in patient, which is worth stating
-- in the runbook — on staging it presents as "the magic link is broken".
DELETE FROM "patient_session";--> statement-breakpoint
CREATE TABLE "patient_ba_account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_ba_account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "patient_verification" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_account_token" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY "child_org_isolation" ON "patient_account_token" CASCADE;--> statement-breakpoint
DROP TABLE "patient_account_token" CASCADE;--> statement-breakpoint
ALTER TABLE "patient_session" DROP CONSTRAINT "patient_session_token_hash_unique";--> statement-breakpoint
ALTER TABLE "patient_session" DROP CONSTRAINT "patient_session_customer_account_id_customer_account_id_fk";
--> statement-breakpoint
DROP INDEX "idx_patient_session_customer_account_id";--> statement-breakpoint
ALTER TABLE "customer_account" ADD COLUMN "name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_account" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "customer_account" ADD COLUMN "image" text;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "token" text NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "ip_address" text;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "patient_session" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "patient_ba_account" ADD CONSTRAINT "patient_ba_account_user_id_customer_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_session" ADD CONSTRAINT "patient_session_user_id_customer_account_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."customer_account"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_session" ADD CONSTRAINT "patient_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_patient_session_user_id" ON "patient_session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_patient_session_token" ON "patient_session" USING btree ("token");--> statement-breakpoint
ALTER TABLE "patient_auth" DROP COLUMN "failed_login_attempts";--> statement-breakpoint
ALTER TABLE "patient_auth" DROP COLUMN "locked_until";--> statement-breakpoint
ALTER TABLE "patient_session" DROP COLUMN "customer_account_id";--> statement-breakpoint
ALTER TABLE "patient_session" DROP COLUMN "token_hash";--> statement-breakpoint
ALTER TABLE "patient_session" DROP COLUMN "revoked_at";--> statement-breakpoint
ALTER TABLE "patient_session" ADD CONSTRAINT "patient_session_token_unique" UNIQUE("token");--> statement-breakpoint
DROP TYPE "public"."patient_account_token_purpose";