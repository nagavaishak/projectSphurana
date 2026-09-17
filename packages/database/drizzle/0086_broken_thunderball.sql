CREATE TYPE "public"."intake_submission_status" AS ENUM('pending', 'completed');--> statement-breakpoint
CREATE TABLE "appointment_service" (
	"id" text PRIMARY KEY NOT NULL,
	"appointment_id" text NOT NULL,
	"service_id" text,
	"name" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price_cents" integer,
	"practitioner_id" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_service" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake_form" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	CONSTRAINT "uq_intake_form_org_name" UNIQUE("organization_id","name")
);
--> statement-breakpoint
ALTER TABLE "intake_form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "intake_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"intake_form_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"appointment_id" text,
	"status" "intake_submission_status" DEFAULT 'pending' NOT NULL,
	"token_hash" text,
	"fields_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sent_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "intake_submission_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "intake_submission" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_service_intake_form" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"service_id" text NOT NULL,
	"intake_form_id" text NOT NULL,
	"blocks_booking" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_org_service_intake_form" UNIQUE("service_id","intake_form_id")
);
--> statement-breakpoint
ALTER TABLE "organization_service_intake_form" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organization_photo" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_cover" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_photo" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "about" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "amenities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_service" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_service" ADD CONSTRAINT "appointment_service_practitioner_id_practitioner_id_fk" FOREIGN KEY ("practitioner_id") REFERENCES "public"."practitioner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_form" ADD CONSTRAINT "intake_form_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_intake_form_id_intake_form_id_fk" FOREIGN KEY ("intake_form_id") REFERENCES "public"."intake_form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_submission" ADD CONSTRAINT "intake_submission_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_intake_form" ADD CONSTRAINT "organization_service_intake_form_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_intake_form" ADD CONSTRAINT "organization_service_intake_form_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_service_intake_form" ADD CONSTRAINT "organization_service_intake_form_intake_form_id_intake_form_id_fk" FOREIGN KEY ("intake_form_id") REFERENCES "public"."intake_form"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_photo" ADD CONSTRAINT "organization_photo_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointment_service_appointment" ON "appointment_service" USING btree ("appointment_id","sort_order");--> statement-breakpoint
CREATE INDEX "idx_appointment_service_service" ON "appointment_service" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_intake_form_organization_id" ON "intake_form" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_intake_submission_org_id" ON "intake_submission" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_intake_submission_lead_id" ON "intake_submission" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_intake_submission_appointment_id" ON "intake_submission" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_intake_submission_appt_status" ON "intake_submission" USING btree ("appointment_id","status");--> statement-breakpoint
CREATE INDEX "idx_org_service_intake_form_service_id" ON "organization_service_intake_form" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_org_service_intake_form_form_id" ON "organization_service_intake_form" USING btree ("intake_form_id");--> statement-breakpoint
CREATE INDEX "idx_organization_photo_org_sort" ON "organization_photo" USING btree ("organization_id","sort_order");--> statement-breakpoint
CREATE POLICY "join_org_isolation" ON "appointment_service" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM appointment p
    WHERE p.id = appointment_service.appointment_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM appointment p
    WHERE p.id = appointment_service.appointment_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "intake_form" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "intake_submission" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "organization_service_intake_form" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "organization_photo" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));