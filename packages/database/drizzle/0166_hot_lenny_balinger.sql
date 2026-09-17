CREATE TYPE "public"."form_kind" AS ENUM('intake', 'consent', 'note');--> statement-breakpoint
CREATE TYPE "public"."form_submission_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TYPE "public"."form_visibility" AS ENUM('staff_only', 'patient');--> statement-breakpoint
CREATE TABLE "form" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "form_kind" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"requires_signature" boolean DEFAULT false NOT NULL,
	"patient_visibility" "form_visibility" DEFAULT 'staff_only' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "form_note_not_patient_visible_by_default" CHECK ("form"."kind" <> 'note' OR "form"."requires_signature" = false OR "form"."patient_visibility" = 'staff_only')
);
--> statement-breakpoint
ALTER TABLE "form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_service_requirement" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"form_id" text NOT NULL,
	"service_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_service_requirement_unique" UNIQUE("form_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "form_service_requirement" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_signature" (
	"id" text PRIMARY KEY NOT NULL,
	"submission_id" text NOT NULL,
	"signed_by_name" text,
	"signed_at" timestamp,
	"signed_ip" text,
	"signature_image_key" text,
	"pdf_key" text,
	"pdf_generation_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_signature_submission_id_unique" UNIQUE("submission_id"),
	CONSTRAINT "form_signature_signed_has_who_and_when" CHECK (("form_signature"."signed_at" IS NULL) = ("form_signature"."signed_by_name" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "form_signature" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"form_id" text NOT NULL,
	"kind" "form_kind" NOT NULL,
	"patient_visibility" "form_visibility" DEFAULT 'staff_only' NOT NULL,
	"lead_id" text,
	"appointment_id" text,
	"fields_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb,
	"status" "form_submission_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"sent_at" timestamp,
	"reminder_sent_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_service_requirement" ADD CONSTRAINT "form_service_requirement_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_service_requirement" ADD CONSTRAINT "form_service_requirement_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_service_requirement" ADD CONSTRAINT "form_service_requirement_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_signature" ADD CONSTRAINT "form_signature_submission_id_form_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_form_org_kind" ON "form" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE INDEX "idx_form_service_requirement_service" ON "form_service_requirement" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_form_submission_appointment" ON "form_submission" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_form_submission_lead" ON "form_submission" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_form_submission_org_kind" ON "form_submission" USING btree ("organization_id","kind");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "form" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "form_service_requirement" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "form_signature" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM form_submission p
    WHERE p.id = form_signature.submission_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM form_submission p
    WHERE p.id = form_signature.submission_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "patient_self" ON "form_submission" AS PERMISSIVE FOR SELECT TO "app_patient" USING ((form_submission.lead_id = current_setting('app.current_patient_lead_id', true) AND form_submission.organization_id = current_setting('app.current_org_id', true)) AND (form_submission.patient_visibility = 'patient'));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "form_submission" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
-- HAND-WRITTEN SECTION — app_patient grants
--
-- A `patient_self` policy without a matching GRANT is DEAD: the read fails
-- "permission denied for table" before the policy is ever evaluated. That was
-- ENG-647 on `patient_auth`, and it is silent — the table simply appears empty
-- to the portal. Least privilege: SELECT only, and only the two tables a
-- patient-scoped read touches.
--
-- `form` itself is NOT granted. A submission carries `fields_snapshot`, so the
-- portal never needs the template row, and not granting it keeps staff-only
-- note TEMPLATES unreadable even by name.
GRANT SELECT ON "form_submission" TO app_patient;--> statement-breakpoint
GRANT SELECT ON "form_signature" TO app_patient;
