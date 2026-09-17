ALTER TABLE "content_batch_attempt" RENAME TO "content_attempt";--> statement-breakpoint
ALTER TABLE "content_batch_item" RENAME TO "content_item";--> statement-breakpoint
ALTER TABLE "content_batch_item_message" RENAME TO "content_item_message";--> statement-breakpoint

-- HAND-EDITED. drizzle-kit emitted DROP CONSTRAINT + ADD CONSTRAINT and
-- DROP INDEX + CREATE INDEX for every object whose generated name embeds the
-- old table name. Re-adding a foreign key revalidates the whole table under
-- ACCESS EXCLUSIVE, and dropping an index leaves reads unindexed until the
-- rebuild finishes. Neither is needed: the objects are unchanged, only their
-- names are, so RENAME does it as a catalog write.
ALTER TABLE "content_attempt" RENAME CONSTRAINT "content_batch_attempt_organization_id_organization_id_fk" TO "content_attempt_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "content_attempt" RENAME CONSTRAINT "content_batch_attempt_slot_id_content_batch_item_id_fk" TO "content_attempt_slot_id_content_item_id_fk";--> statement-breakpoint
ALTER TABLE "content_attempt" RENAME CONSTRAINT "content_batch_attempt_batch_id_content_batch_id_fk" TO "content_attempt_batch_id_content_batch_id_fk";--> statement-breakpoint
ALTER TABLE "content_attempt" RENAME CONSTRAINT "content_batch_attempt_video_id_video_id_fk" TO "content_attempt_video_id_video_id_fk";--> statement-breakpoint
ALTER TABLE "content_attempt" RENAME CONSTRAINT "content_batch_attempt_graphic_id_graphic_id_fk" TO "content_attempt_graphic_id_graphic_id_fk";--> statement-breakpoint
ALTER TABLE "content_item" RENAME CONSTRAINT "content_batch_item_organization_id_organization_id_fk" TO "content_item_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "content_item" RENAME CONSTRAINT "content_batch_item_batch_id_content_batch_id_fk" TO "content_item_batch_id_content_batch_id_fk";--> statement-breakpoint
ALTER TABLE "content_item_message" RENAME CONSTRAINT "content_batch_item_message_organization_id_organization_id_fk" TO "content_item_message_organization_id_organization_id_fk";--> statement-breakpoint
ALTER TABLE "content_item_message" RENAME CONSTRAINT "content_batch_item_message_batch_id_content_batch_id_fk" TO "content_item_message_batch_id_content_batch_id_fk";--> statement-breakpoint
ALTER TABLE "content_item_message" RENAME CONSTRAINT "content_batch_item_message_item_id_content_batch_item_id_fk" TO "content_item_message_item_id_content_item_id_fk";--> statement-breakpoint
ALTER INDEX "idx_content_batch_attempt_slot_number" RENAME TO "idx_content_attempt_slot_number";--> statement-breakpoint
ALTER INDEX "idx_content_batch_attempt_batch_id" RENAME TO "idx_content_attempt_batch_id";--> statement-breakpoint
ALTER INDEX "idx_content_batch_item_batch_id" RENAME TO "idx_content_item_batch_id";--> statement-breakpoint
ALTER INDEX "idx_content_batch_item_batch_kind_position" RENAME TO "idx_content_item_batch_kind_position";--> statement-breakpoint
ALTER INDEX "idx_content_batch_item_current_attempt" RENAME TO "idx_content_item_current_attempt";--> statement-breakpoint
ALTER INDEX "idx_content_batch_item_message_item_created" RENAME TO "idx_content_item_message_item_created";--> statement-breakpoint
ALTER INDEX "idx_content_batch_item_message_batch_id" RENAME TO "idx_content_item_message_batch_id";--> statement-breakpoint

-- Backward-compatible views, dropped by the NEXT migration.
--
-- The api deploys ROLLING: for the length of the roll, machines running the
-- previous release are still issuing queries against content_batch_item and
-- friends. Without these they would 500 on every batch-review request until
-- the last old machine drained.
--
-- Simple single-table views are auto-updatable in Postgres, so writes from
-- old machines land on the real tables. security_invoker = true is
-- load-bearing: without it the view executes as its OWNER, which would
-- bypass the row-level policies on the underlying table and turn a
-- compatibility shim into a cross-org read.
CREATE VIEW "content_batch_item" WITH (security_invoker = true) AS SELECT * FROM "content_item";--> statement-breakpoint
CREATE VIEW "content_batch_attempt" WITH (security_invoker = true) AS SELECT * FROM "content_attempt";--> statement-breakpoint
CREATE VIEW "content_batch_item_message" WITH (security_invoker = true) AS SELECT * FROM "content_item_message";
