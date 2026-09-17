ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'create_campaign';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'create_lead';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'update_lead';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'create_service';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'update_service';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'send_reply';--> statement-breakpoint
ALTER TYPE "public"."claire_confirmation_action" ADD VALUE IF NOT EXISTS 'delete_video_draft';
