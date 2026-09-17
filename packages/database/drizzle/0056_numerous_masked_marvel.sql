ALTER TABLE "lead" ADD COLUMN "psid" text;--> statement-breakpoint
ALTER TABLE "lead_form" ADD COLUMN "organization_service_id" text;--> statement-breakpoint
ALTER TABLE "lead_form" ADD COLUMN "service_link_source" text;--> statement-breakpoint
ALTER TABLE "lead_form" ADD CONSTRAINT "lead_form_organization_service_id_organization_service_id_fk" FOREIGN KEY ("organization_service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_psid" ON "lead" USING btree ("psid");--> statement-breakpoint
CREATE INDEX "idx_lead_form_meta_form_id" ON "lead_form" USING btree ("meta_form_id");--> statement-breakpoint
CREATE INDEX "idx_lead_form_org_service_id" ON "lead_form" USING btree ("organization_service_id");