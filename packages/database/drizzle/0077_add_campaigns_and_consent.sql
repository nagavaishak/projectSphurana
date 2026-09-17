CREATE TYPE "public"."campaign_channel" AS ENUM('email', 'sms', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."campaign_event_type" AS ENUM('sent', 'delivered', 'open', 'click', 'unsubscribe', 'conversion', 'paused', 'resumed');--> statement-breakpoint
CREATE TYPE "public"."campaign_recipient_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'failed', 'bounced', 'opted_out', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'paused', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."campaign_type" AS ENUM('intro_offer', 'gmb_review', 'custom');--> statement-breakpoint
CREATE TYPE "public"."sms_number_status" AS ENUM('provisioning', 'active', 'failed', 'released');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribe', 'stop', 'bounce', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_template_status" AS ENUM('pending', 'approved', 'rejected', 'paused', 'disabled');--> statement-breakpoint
ALTER TYPE "public"."consent_source" ADD VALUE 'booking_form';--> statement-breakpoint
ALTER TYPE "public"."consent_source" ADD VALUE 'incoming_message';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE 'launch_campaign';--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" "campaign_type" DEFAULT 'custom' NOT NULL,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"channels" text[] NOT NULL,
	"segment_id" text,
	"sequence_id" text,
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "campaign" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_event" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"recipient_id" text,
	"type" "campaign_event_type" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_event" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_message" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"channel" "campaign_channel" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"whatsapp_template_id" text,
	"media_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_campaign_message_campaign_channel" UNIQUE("campaign_id","channel")
);
--> statement-breakpoint
ALTER TABLE "campaign_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "campaign_recipient" (
	"id" text PRIMARY KEY NOT NULL,
	"campaign_id" text NOT NULL,
	"lead_id" text NOT NULL,
	"channel" "campaign_channel" NOT NULL,
	"status" "campaign_recipient_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"error" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"opened_at" timestamp,
	"clicked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_campaign_recipient_campaign_lead_channel" UNIQUE("campaign_id","lead_id","channel")
);
--> statement-breakpoint
ALTER TABLE "campaign_recipient" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "email_sender_identity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subdomain" text,
	"display_name" text,
	"reply_to" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_email_sender_identity_org_id" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "email_sender_identity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "org_sms_number" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"phone_number" text NOT NULL,
	"twilio_sid" text NOT NULL,
	"country" text NOT NULL,
	"ten_dlc_campaign_sid" text,
	"status" "sms_number_status" DEFAULT 'provisioning' NOT NULL,
	"provisioned_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_org_sms_number_org_id" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "org_sms_number" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "segment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"filter_json" jsonb NOT NULL,
	"is_dynamic" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "segment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppression" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"channel" "campaign_channel" NOT NULL,
	"contact" text NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_suppression_org_channel_contact" UNIQUE("organization_id","channel","contact")
);
--> statement-breakpoint
ALTER TABLE "suppression" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_template" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"language_code" text DEFAULT 'en' NOT NULL,
	"category" text,
	"status" "whatsapp_template_status" DEFAULT 'pending' NOT NULL,
	"body" text NOT NULL,
	"meta_template_id" text,
	"synced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_whatsapp_template_org_name_lang" UNIQUE("organization_id","name","language_code")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_template" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "last_contacted_at" timestamp;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_segment_id_segment_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segment"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_event" ADD CONSTRAINT "campaign_event_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_event" ADD CONSTRAINT "campaign_event_recipient_id_campaign_recipient_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."campaign_recipient"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_message" ADD CONSTRAINT "campaign_message_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_message" ADD CONSTRAINT "campaign_message_whatsapp_template_id_whatsapp_template_id_fk" FOREIGN KEY ("whatsapp_template_id") REFERENCES "public"."whatsapp_template"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_recipient" ADD CONSTRAINT "campaign_recipient_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sender_identity" ADD CONSTRAINT "email_sender_identity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_sms_number" ADD CONSTRAINT "org_sms_number_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment" ADD CONSTRAINT "segment_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppression" ADD CONSTRAINT "suppression_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_template" ADD CONSTRAINT "whatsapp_template_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_campaign_org_id" ON "campaign" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_status" ON "campaign" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaign_segment_id" ON "campaign" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_event_campaign_id" ON "campaign_event" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_event_recipient_id" ON "campaign_event" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_event_type" ON "campaign_event" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_campaign_message_campaign_id" ON "campaign_message" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipient_campaign_id" ON "campaign_recipient" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipient_lead_id" ON "campaign_recipient" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipient_status" ON "campaign_recipient" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_campaign_recipient_provider_msg_id" ON "campaign_recipient" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "idx_segment_org_id" ON "segment" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_suppression_org_id" ON "suppression" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_whatsapp_template_org_id" ON "whatsapp_template" USING btree ("organization_id");--> statement-breakpoint
CREATE POLICY "org_isolation" ON "campaign" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "campaign_event" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "campaign_message" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "campaign_recipient" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM campaign p
    WHERE p.id = campaign_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "email_sender_identity" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "org_sms_number" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "segment" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "suppression" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "whatsapp_template" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));