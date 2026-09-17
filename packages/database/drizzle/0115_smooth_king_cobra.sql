CREATE TYPE "public"."claire_action_intent_type" AS ENUM('create_campaign', 'create_lead_form', 'launch_ad');--> statement-breakpoint
CREATE TABLE "claire_action_intent" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"action" "claire_action_intent_type" NOT NULL,
	"normalized_key" text NOT NULL,
	"resource_id" text,
	"display_name" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "claire_action_intent" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "claire_action_intent" ADD CONSTRAINT "claire_action_intent_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claire_action_intent" ADD CONSTRAINT "claire_action_intent_conversation_id_assistant_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_claire_action_intent_org_action_created" ON "claire_action_intent" USING btree ("organization_id","action","created_at");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "claire_action_intent" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));