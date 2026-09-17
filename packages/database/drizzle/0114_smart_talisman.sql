CREATE TYPE "public"."sms_sender_mode" AS ENUM('alpha', 'number');--> statement-breakpoint
CREATE TABLE "org_sms_sender" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"mode" "sms_sender_mode" DEFAULT 'alpha' NOT NULL,
	"sender_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_org_sms_sender_org_id" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "org_sms_sender" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "org_sms_sender" ADD CONSTRAINT "org_sms_sender_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "org_sms_sender" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));