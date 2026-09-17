CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete', 'restore');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('user', 'system', 'job');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" text,
	"organization_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "practitioner" DROP CONSTRAINT "practitioner_org_email_unique";--> statement-breakpoint
DROP INDEX "idx_offer_org_code_unique";--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "asset" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "video" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "sequence" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "appointment" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "practitioner" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "offer" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_org_id" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "practitioner_org_email_unique" ON "practitioner" USING btree ("organization_id","email") WHERE "practitioner"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_offer_org_code_unique" ON "offer" USING btree ("organization_id",lower("code")) WHERE "offer"."code" IS NOT NULL AND "offer"."deleted_at" IS NULL;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "audit_log" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));