CREATE TYPE "public"."treatment_plan_channel" AS ENUM('email', 'portal');--> statement-breakpoint
CREATE TYPE "public"."treatment_plan_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TABLE "treatment_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"submission_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"status" "treatment_plan_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treatment_plan" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "treatment_plan_delivery" (
	"id" text PRIMARY KEY NOT NULL,
	"treatment_plan_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"channel" "treatment_plan_channel" NOT NULL,
	"recipient_email" text,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"sent_by_id" text
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_delivery" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "treatment_plan_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"form_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treatment_plan_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form" DROP CONSTRAINT "form_note_not_patient_visible_by_default";--> statement-breakpoint
ALTER TABLE "treatment_plan" ADD CONSTRAINT "treatment_plan_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan" ADD CONSTRAINT "treatment_plan_submission_id_form_submission_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submission"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan" ADD CONSTRAINT "treatment_plan_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan" ADD CONSTRAINT "treatment_plan_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_delivery" ADD CONSTRAINT "treatment_plan_delivery_treatment_plan_id_treatment_plan_id_fk" FOREIGN KEY ("treatment_plan_id") REFERENCES "public"."treatment_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_delivery" ADD CONSTRAINT "treatment_plan_delivery_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_delivery" ADD CONSTRAINT "treatment_plan_delivery_sent_by_id_user_id_fk" FOREIGN KEY ("sent_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_template" ADD CONSTRAINT "treatment_plan_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_plan_template" ADD CONSTRAINT "treatment_plan_template_form_id_form_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."form"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_treatment_plan_lead" ON "treatment_plan" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_treatment_plan_submission" ON "treatment_plan" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "idx_treatment_plan_delivery_plan" ON "treatment_plan_delivery" USING btree ("treatment_plan_id");--> statement-breakpoint
CREATE INDEX "idx_treatment_plan_template_org" ON "treatment_plan_template" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "form" ADD CONSTRAINT "form_note_never_patient_visible" CHECK ("form"."kind" <> 'note' OR "form"."patient_visibility" = 'staff_only');--> statement-breakpoint
CREATE POLICY "patient_self" ON "treatment_plan" AS PERMISSIVE FOR SELECT TO "app_patient" USING ((treatment_plan.lead_id = current_setting('app.current_patient_lead_id', true) AND treatment_plan.organization_id = current_setting('app.current_org_id', true)) AND (treatment_plan.status = 'published'));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "treatment_plan" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "treatment_plan_delivery" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "treatment_plan_template" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
-- HAND-WRITTEN SECTION — app_patient grants
--
-- A `patient_self` policy without a GRANT is DEAD: the read fails "permission
-- denied" before the policy is evaluated and the table just looks empty to the
-- portal (ENG-647). Drizzle does not generate grants.
--
-- Only `treatment_plan` is granted. NOT the template (clinic-internal), NOT
-- the delivery log (who-sent-what is staff information), and emphatically NOT
-- `form` — patients read the plan written for them, never the note.
GRANT SELECT ON "treatment_plan" TO app_patient;
