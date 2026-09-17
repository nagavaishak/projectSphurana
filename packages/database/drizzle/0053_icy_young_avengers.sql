CREATE TYPE "public"."campaign_troubleshoot_round" AS ENUM('none', 'offer_adjusted', 'creative_refreshed');--> statement-breakpoint
ALTER TYPE "public"."assistant_recommendation_kind" ADD VALUE 'campaign_no_leads_4d' BEFORE 'ad_flow_service_pick';--> statement-breakpoint
CREATE TABLE "campaign_troubleshoot_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"meta_campaign_id" text NOT NULL,
	"current_round" "campaign_troubleshoot_round" DEFAULT 'none' NOT NULL,
	"offers_tried" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creatives_tried" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"escalated_at" timestamp,
	"last_diagnosed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_troubleshoot_state_org_campaign_unique" UNIQUE("organization_id","meta_campaign_id")
);
--> statement-breakpoint
ALTER TABLE "campaign_troubleshoot_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "campaign_troubleshoot_state" ADD CONSTRAINT "campaign_troubleshoot_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_campaign_troubleshoot_state_org_id" ON "campaign_troubleshoot_state" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "campaign_troubleshoot_state" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));