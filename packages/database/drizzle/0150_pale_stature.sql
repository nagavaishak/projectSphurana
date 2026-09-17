-- Collapse any pre-existing duplicates BEFORE the unique index is created.
--
-- Verified zero duplicate (organization_id, facebook_lead_id) groups in prod at
-- authoring time, so this is expected to affect 0 rows. It stays because the
-- SELECT-then-INSERT race remains open until the index below exists, so a
-- duplicate can still appear between now and deploy — and without this the
-- migration would then fail mid-deploy.
--
-- Soft-delete, never hard-delete: a lead row may already be referenced by
-- conversations, appointments or sequence state. The row KEPT is the oldest
-- (created_at, then id) — the one whose side effects have already fired.
--
-- Written as one windowed pass rather than a correlated EXISTS: this runs
-- BEFORE the index exists, and `lead` holds ~61k rows (~14k with a
-- facebook_lead_id), so a per-row correlated lookup would mean thousands of
-- sequential scans while the deploy waits.
UPDATE "lead"
SET "deleted_at" = now()
WHERE "id" IN (
  SELECT "id"
  FROM (
    SELECT
      "id",
      row_number() OVER (
        PARTITION BY "organization_id", "facebook_lead_id"
        ORDER BY "created_at", "id"
      ) AS rn
    FROM "lead"
    WHERE "facebook_lead_id" IS NOT NULL
      AND "deleted_at" IS NULL
  ) ranked
  WHERE ranked.rn > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_lead_org_facebook_lead_id" ON "lead" USING btree ("organization_id","facebook_lead_id") WHERE facebook_lead_id IS NOT NULL AND deleted_at IS NULL;
