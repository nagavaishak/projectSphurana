CREATE TYPE "public"."claire_confirmation_action" AS ENUM('launch_ad', 'pause_campaign', 'update_budget', 'schedule_post', 'publish_post', 'book_appointment', 'reschedule_appointment', 'cancel_appointment', 'create_offer', 'extend_offer', 'expire_offer', 'assign_lead_to_sequence', 'escalate_conversation');--> statement-breakpoint
CREATE TABLE "claire_confirmation_token" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"action" "claire_confirmation_action" NOT NULL,
	"resource_id" text NOT NULL,
	"payload" jsonb,
	"consumed_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claire_confirmation_token" ADD CONSTRAINT "claire_confirmation_token_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claire_confirmation_token" ADD CONSTRAINT "claire_confirmation_token_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claire_confirmation_token_org_conversation" ON "claire_confirmation_token" USING btree ("organization_id","conversation_id");--> statement-breakpoint
CREATE INDEX "idx_claire_confirmation_token_expires_at" ON "claire_confirmation_token" USING btree ("expires_at");