CREATE TABLE "assistant_whatsapp_link" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"phone_e164" text,
	"verification_code" text,
	"code_expires_at" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_whatsapp_link_phone_e164_unique" UNIQUE("phone_e164")
);
--> statement-breakpoint
ALTER TABLE "assistant_whatsapp_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "channel" text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "whatsapp_phone_e164" text;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "pending_confirmation" jsonb;--> statement-breakpoint
ALTER TABLE "assistant_whatsapp_link" ADD CONSTRAINT "assistant_whatsapp_link_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_whatsapp_link" ADD CONSTRAINT "assistant_whatsapp_link_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_assistant_whatsapp_link_phone_e164" ON "assistant_whatsapp_link" USING btree ("phone_e164");--> statement-breakpoint
CREATE INDEX "idx_assistant_whatsapp_link_user_id" ON "assistant_whatsapp_link" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_assistant_whatsapp_link_org_id" ON "assistant_whatsapp_link" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "assistant_whatsapp_link" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));