CREATE TYPE "public"."content_item_source" AS ENUM('monthly_batch', 'claire_chat', 'content_studio');--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "position" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ALTER COLUMN "batch_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "source" "content_item_source" DEFAULT 'monthly_batch' NOT NULL;--> statement-breakpoint
-- organization_id: add NULLABLE, backfill, then enforce.
--
-- HAND-EDITED. drizzle-kit emitted `ADD COLUMN "organization_id" text NOT NULL`
-- for all three, which cannot succeed on a non-empty table -- every existing
-- row would need a value the statement does not supply. These tables hold live
-- customer content, so the column arrives nullable, is filled from the parent
-- batch, and only then is constrained.
--
-- Every row is reachable: `batch_id` is NOT NULL on all three up to this
-- migration, and nothing writes a standalone row until the code that does
-- ships, so the join finds an organization for every row and SET NOT NULL
-- below cannot fail. If it does, the migration aborts rather than leaving a
-- half-scoped table -- the correct outcome, because an unscoped row is an RLS
-- hole.
ALTER TABLE "content_batch_attempt" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "content_batch_item" AS i SET "organization_id" = b."organization_id" FROM "content_batch" AS b WHERE b."id" = i."batch_id" AND i."organization_id" IS NULL;--> statement-breakpoint
UPDATE "content_batch_attempt" AS a SET "organization_id" = b."organization_id" FROM "content_batch" AS b WHERE b."id" = a."batch_id" AND a."organization_id" IS NULL;--> statement-breakpoint
UPDATE "content_batch_item_message" AS m SET "organization_id" = b."organization_id" FROM "content_batch" AS b WHERE b."id" = m."batch_id" AND m."organization_id" IS NULL;--> statement-breakpoint
UPDATE "content_batch_attempt" AS a SET "organization_id" = i."organization_id" FROM "content_batch_item" AS i WHERE i."id" = a."slot_id" AND a."organization_id" IS NULL AND i."organization_id" IS NOT NULL;--> statement-breakpoint
UPDATE "content_batch_item_message" AS m SET "organization_id" = i."organization_id" FROM "content_batch_item" AS i WHERE i."id" = m."item_id" AND m."organization_id" IS NULL AND i."organization_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ADD CONSTRAINT "content_batch_attempt_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD CONSTRAINT "content_batch_item_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_item_message" ADD CONSTRAINT "content_batch_item_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
DROP POLICY "child_org_isolation" ON "content_batch_attempt" CASCADE;--> statement-breakpoint
DROP POLICY "child_org_isolation" ON "content_batch_item" CASCADE;--> statement-breakpoint
DROP POLICY "child_org_isolation" ON "content_batch_item_message" CASCADE;--> statement-breakpoint
CREATE POLICY "org_isolation" ON "content_batch_attempt" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "content_batch_item" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY "org_isolation" ON "content_batch_item_message" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (organization_id = current_setting('app.current_org_id', true)) WITH CHECK (organization_id = current_setting('app.current_org_id', true));