CREATE TYPE "public"."content_batch_item_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TABLE "content_batch_item_message" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"item_id" text NOT NULL,
	"role" "content_batch_item_message_role" NOT NULL,
	"content" text NOT NULL,
	"caption_snapshot" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ADD CONSTRAINT "content_batch_item_message_batch_id_content_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."content_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ADD CONSTRAINT "content_batch_item_message_item_id_content_batch_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."content_batch_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_message_item_created" ON "content_batch_item_message" USING btree ("item_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_message_batch_id" ON "content_batch_item_message" USING btree ("batch_id");--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "content_batch_item_message" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_item_message.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_item_message.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));