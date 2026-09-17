CREATE TYPE "public"."document_import_kind" AS ENUM('consent_form', 'id_document', 'intake_form', 'invoice', 'referral', 'treatment_record', 'photo', 'other');--> statement-breakpoint
CREATE TYPE "public"."document_import_match_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."document_import_status" AS ENUM('uploading', 'pending', 'processing', 'matched', 'needs_review', 'failed', 'discarded');--> statement-breakpoint
CREATE TABLE "document_import" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"uploaded_by_user_id" text,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"status" "document_import_status" DEFAULT 'uploading' NOT NULL,
	"document_kind" "document_import_kind",
	"matched_lead_id" text,
	"match_source" "document_import_match_source",
	"patient_document_id" text,
	"confidence" real,
	"extracted" jsonb,
	"candidates" jsonb,
	"match_reason" text,
	"failure_reason" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "document_import" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_import" ADD CONSTRAINT "document_import_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import" ADD CONSTRAINT "document_import_uploaded_by_user_id_user_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import" ADD CONSTRAINT "document_import_matched_lead_id_lead_id_fk" FOREIGN KEY ("matched_lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_import" ADD CONSTRAINT "document_import_patient_document_id_patient_document_id_fk" FOREIGN KEY ("patient_document_id") REFERENCES "public"."patient_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_import_org_status" ON "document_import" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_document_import_org_created" ON "document_import" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_document_import_matched_lead" ON "document_import" USING btree ("matched_lead_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "document_import" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));