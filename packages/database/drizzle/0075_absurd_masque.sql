ALTER TABLE "appointment" DROP CONSTRAINT "appointment_assigned_to_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "appointment" ALTER COLUMN "assigned_to_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_assigned_to_id_user_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;