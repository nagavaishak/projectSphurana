-- Split content_batch_item into SLOT (the post) and ATTEMPT (the cut in it).
--
-- HAND-EDITED. drizzle-kit produced the schema delta correctly but emitted it in
-- an order that destroys data: it narrowed the review-status enum and dropped
-- video_id / graphic_id / caption / pending_video_edits / edit_render_count /
-- regeneration_reason / previous_item_id before anything had read them. Every
-- statement below is drizzle's, re-ordered around a backfill. Nothing was added
-- to the schema delta itself.
--
-- The order is load-bearing:
--   1. create content_batch_attempt (+ FKs, indexes) and add the new columns
--   2. BACKFILL — fold each previous_item_id chain into attempts of its root
--   3. narrow the enum   (safe only once no 'regenerated' rows remain)
--   4. drop the columns  (safe only once they have been read)
--
-- Audited against production before writing (42 batches / 417 items / 371
-- chain roots / 46 superseded): chains are linear, nothing dangles, nothing is
-- unreachable, max depth 3. Dev databases are NOT that clean — one had four
-- parents with two children each — so the numbering below tolerates a tree.

CREATE TABLE "content_batch_attempt" (
	"id" text PRIMARY KEY NOT NULL,
	"slot_id" text NOT NULL,
	"batch_id" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"video_id" text,
	"graphic_id" text,
	"caption" text,
	"pending_video_edits" jsonb,
	"edit_render_count" integer DEFAULT 0 NOT NULL,
	"regeneration_reason" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP CONSTRAINT "content_batch_item_video_id_video_id_fk";
--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP CONSTRAINT "content_batch_item_graphic_id_graphic_id_fk";
--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "current_attempt_id" text;--> statement-breakpoint
ALTER TABLE "content_batch_item" ADD COLUMN "pending_regenerate_note" text;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ADD CONSTRAINT "content_batch_attempt_slot_id_content_batch_item_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."content_batch_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ADD CONSTRAINT "content_batch_attempt_batch_id_content_batch_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."content_batch"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ADD CONSTRAINT "content_batch_attempt_video_id_video_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."video"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_batch_attempt" ADD CONSTRAINT "content_batch_attempt_graphic_id_graphic_id_fk" FOREIGN KEY ("graphic_id") REFERENCES "public"."graphic"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_content_batch_attempt_slot_number" ON "content_batch_attempt" USING btree ("slot_id","attempt_number");--> statement-breakpoint
CREATE INDEX "idx_content_batch_attempt_batch_id" ON "content_batch_attempt" USING btree ("batch_id");--> statement-breakpoint
CREATE INDEX "idx_content_batch_item_current_attempt" ON "content_batch_item" USING btree ("current_attempt_id");--> statement-breakpoint

-- ── BACKFILL ────────────────────────────────────────────────────────────────
-- Walk every previous_item_id relationship to its root. The root becomes the
-- slot; every row reachable from it becomes one attempt.
--
-- Numbered by created_at, NOT by depth. Depth is the obvious choice and it is
-- wrong: regenerate has been called twice against the same parent on dev
-- databases, giving one row two children at equal depth, which would collide on
-- UNIQUE (slot_id, attempt_number) and abort. Ordering by time is total, so a
-- fork collapses into one honest sequence. `id` breaks exact-timestamp ties so
-- the result is deterministic rather than dependent on scan order.
--
-- previous_item_id never had a foreign key, so a pointer can dangle. An item
-- whose parent no longer exists is treated as its own root rather than being
-- stranded unreachable — silently losing a post here is the worst outcome
-- available. (Production has none; dev is not guaranteed to stay that way.)
--
-- The depth guard is a cycle backstop, not a business rule: the cap is 3, so a
-- chain deeper than 10 is corrupt, and a recursive CTE over a cycle never ends.
CREATE TEMP TABLE "_slot_chain" ON COMMIT DROP AS
WITH RECURSIVE tree AS (
  SELECT i.id AS root_id, i.id AS item_id, 0 AS depth
  FROM content_batch_item i
  WHERE i.previous_item_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM content_batch_item p WHERE p.id = i.previous_item_id
     )
  UNION ALL
  SELECT t.root_id, i.id, t.depth + 1
  FROM content_batch_item i
  JOIN tree t ON i.previous_item_id = t.item_id
  WHERE t.depth < 10
),
numbered AS (
  SELECT
    t.root_id,
    t.item_id,
    CAST(row_number() OVER (
      PARTITION BY t.root_id ORDER BY i.created_at, i.id
    ) - 1 AS integer) AS attempt_number
  FROM tree t
  JOIN content_batch_item i ON i.id = t.item_id
)
SELECT
  root_id,
  item_id,
  attempt_number,
  attempt_number = MAX(attempt_number) OVER (PARTITION BY root_id) AS is_live
FROM numbered;--> statement-breakpoint

-- One attempt per row, carrying everything that describes that cut.
INSERT INTO "content_batch_attempt" (
  "id", "slot_id", "batch_id", "attempt_number", "video_id", "graphic_id",
  "caption", "pending_video_edits", "edit_render_count", "regeneration_reason",
  "created_at"
)
SELECT
  gen_random_uuid()::text, c.root_id, i.batch_id, c.attempt_number,
  i.video_id, i.graphic_id, i.caption, i.pending_video_edits,
  i.edit_render_count, i.regeneration_reason, i.created_at
FROM "_slot_chain" c
JOIN content_batch_item i ON i.id = c.item_id;--> statement-breakpoint

-- Point each slot at the newest cut.
UPDATE "content_batch_item" s
SET "current_attempt_id" = a.id
FROM "_slot_chain" c
JOIN "content_batch_attempt" a
  ON a.slot_id = c.root_id AND a.attempt_number = c.attempt_number
WHERE s.id = c.root_id AND c.is_live;--> statement-breakpoint

-- Lift slot-level state from the live row up to the root. Accept, reject and
-- schedule wrote to whichever row was current at the time, so on a regenerated
-- slot the root still holds stale defaults. (Production reports zero superseded
-- rows holding a decision, but the root's own values are still pre-regenerate.)
UPDATE "content_batch_item" root
SET
  "review_status"            = live."review_status",
  "scheduled_at"             = live."scheduled_at",
  "target_page_ids"          = live."target_page_ids",
  "scheduled_social_post_id" = live."scheduled_social_post_id",
  "decided_at"               = live."decided_at",
  "regeneration_count"       = live."regeneration_count",
  "video_idea"               = live."video_idea"
FROM "_slot_chain" c
JOIN "content_batch_item" live ON live.id = c.item_id
WHERE root.id = c.root_id
  AND c.is_live
  AND live.id <> root.id;--> statement-breakpoint

-- Re-parent the review threads onto the slot. THIS IS THE STEP THAT RECOVERS
-- ORPHANED CONVERSATIONS: a thread written against a superseded row was already
-- unreachable in the UI, and the DELETE below would have cascaded it away.
-- (No-op on production, which has not yet created this table.)
UPDATE "content_batch_item_message" m
SET "item_id" = c.root_id
FROM "_slot_chain" c
WHERE m."item_id" = c.item_id
  AND c.root_id <> c.item_id;--> statement-breakpoint

-- Superseded rows are attempts now. Remove the duplicates they left behind.
DELETE FROM "content_batch_item" i
USING "_slot_chain" c
WHERE i.id = c.item_id AND c.root_id <> c.item_id;--> statement-breakpoint

-- Nothing may reach the drops below without an attempt behind it. RAISE inside
-- the migration's transaction rolls the whole thing back, so the failure mode is
-- "migration refused" rather than "batch with a hole in it".
DO $$
DECLARE orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM content_batch_item WHERE current_attempt_id IS NULL;
  IF orphan_count > 0 THEN
    RAISE EXCEPTION
      'Backfill left % content_batch_item row(s) with no attempt. Refusing to drop the source columns.',
      orphan_count;
  END IF;
END $$;--> statement-breakpoint
-- ── END BACKFILL ────────────────────────────────────────────────────────────

-- Rows still marked 'regenerated' after the fold are ones nothing supersedes —
-- the flip happened but the replacement never materialised, or it was deleted
-- later. They are live posts wearing a terminal status, so they read as decided
-- while still awaiting a decision, and the narrowed enum has no value for them.
--
-- 'pending' is the honest mapping: the owner has not accepted or rejected this
-- post, and now they can. Production has none of these; a dev database had
-- three, which is how this was found — the first rehearsal aborted right here.
UPDATE "content_batch_item"
SET "review_status" = 'pending'
WHERE CAST("review_status" AS text) = 'regenerated';--> statement-breakpoint

-- Safe now: no 'regenerated' rows remain, so the cast at the end cannot fail.
ALTER TABLE "content_batch_item" ALTER COLUMN "review_status" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "review_status" SET DEFAULT 'pending'::text;--> statement-breakpoint
DROP TYPE "public"."content_batch_item_review_status";--> statement-breakpoint
CREATE TYPE "public"."content_batch_item_review_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "review_status" SET DEFAULT 'pending'::"public"."content_batch_item_review_status";--> statement-breakpoint
ALTER TABLE "content_batch_item" ALTER COLUMN "review_status" SET DATA TYPE "public"."content_batch_item_review_status" USING "review_status"::"public"."content_batch_item_review_status";--> statement-breakpoint
DROP INDEX "idx_content_batch_item_previous";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "video_id";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "graphic_id";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "previous_item_id";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "regeneration_reason";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "caption";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "pending_video_edits";--> statement-breakpoint
ALTER TABLE "content_batch_item" DROP COLUMN "edit_render_count";--> statement-breakpoint
CREATE POLICY "child_org_isolation" ON "content_batch_attempt" AS PERMISSIVE FOR ALL TO "app_authenticated", "app_public" USING (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_attempt.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  )) WITH CHECK (EXISTS (
    SELECT 1
    FROM content_batch p
    WHERE p.id = content_batch_attempt.batch_id
      AND p.organization_id = current_setting('app.current_org_id', true)
  ));
