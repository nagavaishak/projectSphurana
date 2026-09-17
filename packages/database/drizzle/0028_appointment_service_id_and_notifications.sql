CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link_path" text,
	"data" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "service_id" text;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "preferences" jsonb DEFAULT '{"appointments":{"scope":"mine","channels":{"email":true,"push":true}},"inbox":{"scope":"mine","channels":{"email":true,"push":true}},"advertising":{"enabled":true,"channels":{"email":true,"push":true}}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_notification_user_id" ON "notification" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_notification_user_read" ON "notification" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_notification_org_id" ON "notification" USING btree ("organization_id");--> statement-breakpoint
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_service_id_organization_service_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."organization_service"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_appointment_service_id" ON "appointment" USING btree ("service_id");