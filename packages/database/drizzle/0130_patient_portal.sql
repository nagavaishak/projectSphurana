-- ============================================================================
-- Patient portal (ENG-647) — app_patient role + auth tables + policies
-- ============================================================================
-- The patient_self policies below are TO app_patient, so the role MUST exist
-- before CREATE POLICY runs. Provisioned here (not 0049) in the same
-- idempotent, passwordless style — a per-env step sets the password later
-- (see provision-role-passwords.mjs). LOGIN NOBYPASSRLS, least-privilege:
-- SELECT only, on exactly the tables the patient portal reads. Every
-- patient-initiated WRITE goes through the system-scoped patient-auth
-- services (app_system), mirroring how Better Auth writes its own tables.
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_patient') THEN
    CREATE ROLE app_patient LOGIN NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
ALTER ROLE app_patient LOGIN NOBYPASSRLS;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_patient;--> statement-breakpoint
GRANT SELECT ON "lead" TO app_patient;--> statement-breakpoint

CREATE TYPE "public"."patient_account_token_purpose" AS ENUM('activate', 'reset');--> statement-breakpoint
CREATE TYPE "public"."consent_form_submission_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."patient_document_uploaded_by" AS ENUM('patient', 'staff');--> statement-breakpoint
CREATE TABLE "patient_account_token" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_auth_id" text NOT NULL,
	"purpose" "patient_account_token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"requested_ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_account_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "patient_account_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_auth" (
	"id" text PRIMARY KEY NOT NULL,
	"lead_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"password_hash" text,
	"password_set_at" timestamp,
	"last_login_at" timestamp,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_auth_lead_id_unique" UNIQUE("lead_id")
);
--> statement-breakpoint
ALTER TABLE "patient_auth" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_session" (
	"id" text PRIMARY KEY NOT NULL,
	"patient_auth_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "patient_session_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "patient_session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"template_id" text NOT NULL,
	"template_snapshot" jsonb NOT NULL,
	"status" "consent_form_submission_status" DEFAULT 'pending' NOT NULL,
	"field_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signed_by_name" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"sent_at" timestamp,
	"reminder_sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_consent_form_submission_appointment_template" UNIQUE("appointment_id","template_id")
);
--> statement-breakpoint
ALTER TABLE "consent_form_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consent_form_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_signature" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_form_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_service_form_requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"service_id" text NOT NULL,
	"template_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_service_form_requirement" UNIQUE("service_id","template_id")
);
--> statement-breakpoint
ALTER TABLE "organization_service_form_requirement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "patient_document" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"uploaded_by_type" "patient_document_uploaded_by" NOT NULL,
	"uploaded_by_user_id" text,
	"file_name" text NOT NULL,
	"blob_url" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "patient_document" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "patient_account_token" ADD CONSTRAINT "patient_account_token_patient_auth_id_patient_auth_id_fk" FOREIGN KEY ("patient_auth_id") REFERENCES "public"."patient_auth"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_auth" ADD CONSTRAINT "patient_auth_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_auth" ADD CONSTRAINT "patient_auth_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_session" ADD CONSTRAINT "patient_session_patient_auth_id_patient_auth_id_fk" FOREIGN KEY ("patient_auth_id") REFERENCES "public"."patient_auth"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_submission" ADD CONSTRAINT "consent_form_submission_template_id_consent_form_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."consent_form_template"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_form_template" ADD CONSTRAINT "consent_form_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_form_requirement" ADD CONSTRAINT "organization_service_form_requirement_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_form_requirement" ADD CONSTRAINT "organization_service_form_requirement_template_id_consent_form_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."consent_form_template"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_document" ADD CONSTRAINT "patient_document_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_document" ADD CONSTRAINT "patient_document_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_document" ADD CONSTRAINT "patient_document_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_patient_account_token_auth_id" ON "patient_account_token" USING btree ("patient_auth_id");--> statement-breakpoint
CREATE INDEX "idx_patient_auth_org_id" ON "patient_auth" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_patient_session_auth_id" ON "patient_session" USING btree ("patient_auth_id");--> statement-breakpoint
CREATE INDEX "idx_consent_form_submission_org_id" ON "consent_form_submission" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_consent_form_submission_appointment_id" ON "consent_form_submission" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_consent_form_submission_lead_id" ON "consent_form_submission" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_consent_form_template_org_id" ON "consent_form_template" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_service_form_requirement_service_id" ON "organization_service_form_requirement" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_patient_document_org_id" ON "patient_document" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_patient_document_lead_id" ON "patient_document" USING btree ("lead_id");--> statement-breakpoint
CREATE POLICY "patient_self" ON "lead" AS PERMISSIVE FOR SELECT TO "app_patient" USING (lead.id = current_setting('app.current_patient_lead_id', true));--> statement-breakpoint
CREATE POLICY "patient_self" ON "appointment" AS PERMISSIVE FOR SELECT TO "app_patient" USING (appointment.lead_id = current_setting('app.current_patient_lead_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "patient_account_token" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM patient_auth p
    WHERE p.id = patient_account_token.patient_auth_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM patient_auth p
    WHERE p.id = patient_account_token.patient_auth_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "patient_self" ON "patient_auth" AS PERMISSIVE FOR SELECT TO "app_patient" USING (patient_auth.lead_id = current_setting('app.current_patient_lead_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "patient_auth" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "patient_session" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM patient_auth p
    WHERE p.id = patient_session.patient_auth_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM patient_auth p
    WHERE p.id = patient_session.patient_auth_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "patient_self" ON "consent_form_submission" AS PERMISSIVE FOR SELECT TO "app_patient" USING (consent_form_submission.lead_id = current_setting('app.current_patient_lead_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "consent_form_submission" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "consent_form_template" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "organization_service_form_requirement" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM consent_form_template p
    WHERE p.id = organization_service_form_requirement.template_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM consent_form_template p
    WHERE p.id = organization_service_form_requirement.template_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "patient_self" ON "patient_document" AS PERMISSIVE FOR SELECT TO "app_patient" USING (patient_document.lead_id = current_setting('app.current_patient_lead_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "patient_document" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
-- Least privilege: SELECT only, and only on the tables a patient-scoped
-- read actually touches (appointment, consent_form_submission,
-- patient_document, plus `lead` granted in the header above). Each of
-- these has a matching `patient_self` policy TO app_patient.
GRANT SELECT ON "appointment" TO app_patient;--> statement-breakpoint
GRANT SELECT ON "consent_form_submission" TO app_patient;--> statement-breakpoint
GRANT SELECT ON "patient_document" TO app_patient;--> statement-breakpoint
-- `patient_auth` carries a `patient_self` policy TO app_patient (above) but was
-- never granted to the role, so that policy was dead — any app_patient read of
-- it fails "permission denied" before the policy is evaluated. Grant SELECT so
-- the self-policy is actually reachable and the role can read its own
-- membership row. (ENG-647 review: policy-without-grant.)
GRANT SELECT ON "patient_auth" TO app_patient;
