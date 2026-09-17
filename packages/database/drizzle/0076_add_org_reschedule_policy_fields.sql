ALTER TABLE "organization" ADD COLUMN "rescheduling_notice_required_hours" integer DEFAULT 24;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "no_show_or_late_cancel_fee_cents" integer;