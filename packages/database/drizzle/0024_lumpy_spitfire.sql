ALTER TYPE "public"."assistant_message_role" ADD VALUE 'agent';--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "intercom_conversation_id" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "agent_name" text;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD COLUMN "agent_avatar_url" text;--> statement-breakpoint
CREATE INDEX "idx_assistant_conversation_intercom_id" ON "assistant_conversation" USING btree ("intercom_conversation_id");