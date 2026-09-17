-- Hand-written migration.
--
-- This migration:
--   1. Adds one-click escalation support to assistant_conversation.
--   2. Creates assistant_recommendation, the "Claire card" table consumed by
--      the in-app widget. See docs/plans/claire-owner-spec.md §6.
--
-- Originally hand-written before staging's baseline squash (so that
-- `pnpm db:generate` wouldn't extend the broken pre-baseline chain). Post-
-- rebase it now sits at idx 0001 with a generated `meta/0001_snapshot.json`
-- that points at `0000_baseline`'s id; the migration-ordering CI workflow
-- validates the chain end-to-end.

CREATE TYPE "public"."assistant_conversation_status" AS ENUM('active', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."assistant_recommendation_kind" AS ENUM('content_no_post_14_days', 'content_unused_assets', 'content_learning_phase_prompt', 'lead_first_of_session', 'lead_unreplied_2h', 'lead_flagged_problem', 'booking_confirmed', 'pre_appointment_prep', 'learning_phase_reassurance', 'creative_refresh_needed', 'campaign_learning_phase_exit', 'prompt_create_first_ad', 'prompt_create_first_offer', 'prompt_record_first_video', 'prompt_create_first_graphic', 'prompt_create_first_post');--> statement-breakpoint
CREATE TYPE "public"."assistant_recommendation_state" AS ENUM('active', 'dismissed', 'actioned', 'expired');--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN IF NOT EXISTS "status" "assistant_conversation_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN IF NOT EXISTS "escalated_at" timestamp;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN IF NOT EXISTS "escalation_reason" text;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assistant_recommendation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" "assistant_recommendation_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"primary_action" jsonb NOT NULL,
	"state" "assistant_recommendation_state" DEFAULT 'active' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"actioned_at" timestamp,
	"dismissed_at" timestamp,
	"expires_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "assistant_recommendation" ADD CONSTRAINT "assistant_recommendation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assistant_conversation_status" ON "assistant_conversation" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assistant_recommendation_org_id" ON "assistant_recommendation" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assistant_recommendation_state" ON "assistant_recommendation" USING btree ("state");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assistant_recommendation_kind" ON "assistant_recommendation" USING btree ("kind");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_assistant_recommendation_org_state_kind" ON "assistant_recommendation" USING btree ("organization_id","state","kind");
