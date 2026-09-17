ALTER TYPE "public"."lead_source" ADD VALUE 'sms' BEFORE 'website';--> statement-breakpoint
ALTER TYPE "public"."messaging_platform" ADD VALUE 'sms';--> statement-breakpoint
ALTER TABLE "org_sms_number" ADD COLUMN "is_chatbot_active" boolean DEFAULT true NOT NULL;