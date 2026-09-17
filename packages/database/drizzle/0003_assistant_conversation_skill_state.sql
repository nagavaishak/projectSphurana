ALTER TABLE "assistant_conversation" ADD COLUMN "loaded_skill_ids" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "skill_registry_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "archived_at" timestamp;