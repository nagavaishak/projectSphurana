ALTER TABLE "assistant_message" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."assistant_message_role";--> statement-breakpoint
CREATE TYPE "public"."assistant_message_role" AS ENUM('user', 'assistant', 'system', 'tool');--> statement-breakpoint
ALTER TABLE "assistant_message" ALTER COLUMN "role" SET DATA TYPE "public"."assistant_message_role" USING "role"::"public"."assistant_message_role";--> statement-breakpoint
DROP INDEX "idx_assistant_conversation_intercom_id";--> statement-breakpoint
ALTER TABLE "assistant_message" DROP COLUMN "agent_name";--> statement-breakpoint
ALTER TABLE "assistant_message" DROP COLUMN "agent_avatar_url";