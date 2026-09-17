CREATE TABLE "appointment_manage_token" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"appointment_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_manage_token_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "appointment_manage_token" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointment_manage_token" ADD CONSTRAINT "appointment_manage_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_manage_token" ADD CONSTRAINT "appointment_manage_token_appointment_id_appointment_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointment_manage_token_org_hash" ON "appointment_manage_token" USING btree ("organization_id","token_hash");--> statement-breakpoint
CREATE INDEX "idx_appointment_manage_token_appointment_id" ON "appointment_manage_token" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_appointment_manage_token_expires_at" ON "appointment_manage_token" USING btree ("expires_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "appointment_manage_token" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));