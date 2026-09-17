ALTER TABLE "lead" ADD COLUMN "converted_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "last_visit_at" timestamp;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "lifetime_spend_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "lead" ADD COLUMN "list_rank" smallint GENERATED ALWAYS AS ((CASE WHEN converted_at IS NOT NULL OR source NOT IN ('facebook','instagram','whatsapp') OR (email IS NOT NULL AND email <> '') OR (phone IS NOT NULL AND phone <> '') THEN 0 ELSE 1 END)) STORED;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "lead_id" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_lead_org_status" ON "lead" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_lead_org_converted_at" ON "lead" USING btree ("organization_id","converted_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_lead_org_list_rank" ON "lead" USING btree ("organization_id","list_rank","created_at" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "idx_conversation_lead_id" ON "conversation" USING btree ("organization_id","lead_id");