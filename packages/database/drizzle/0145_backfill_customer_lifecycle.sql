-- Custom SQL migration file, put your code below! --
--
-- Backfill for the Customers surface (unify-leads-and-customers, Phase 1).
-- Idempotent and re-runnable: every UPDATE recomputes from source-of-truth
-- tables. Runs as the migration role, which bypasses RLS.
--
-- Pipeline stage is DERIVED at read time and so is not backfilled. What IS
-- written here is the part that cannot be derived cheaply: `converted_at` (the
-- memo of the first booking or paid sale) and the lifetime-value columns.

-- 1. Map every retired stage value off the old sales-funnel vocabulary onto the
--    active pipeline. After this, no live row references a retired value.
UPDATE "lead" SET "status" = CASE
    WHEN "status" IN ('qualified', 'proposal', 'negotiation') THEN 'contacted'
    WHEN "status" = 'won' THEN 'booked'
    WHEN "status" = 'cold' THEN 'lost'
    ELSE "status"
  END
WHERE "status" IN ('qualified', 'proposal', 'negotiation', 'won', 'cold');
--> statement-breakpoint

-- 2. converted_at = earliest of (first booking of ANY kind, first paid sale).
--    Appointment.lead_id is NOT NULL; sale.lead_id is nullable (walk-ins).
UPDATE "lead" l SET "converted_at" = sub.converted_at
FROM (
  SELECT lead_id, MIN(ts) AS converted_at FROM (
    SELECT "lead_id", "created_at" AS ts FROM "appointment"
    UNION ALL
    SELECT "lead_id", "completed_at" AS ts FROM "sale"
      WHERE "status" = 'completed' AND "completed_at" IS NOT NULL AND "lead_id" IS NOT NULL
  ) events
  GROUP BY lead_id
) sub
WHERE l."id" = sub.lead_id AND l."converted_at" IS NULL;
--> statement-breakpoint

-- 3. last_visit_at = most recent COMPLETED appointment start or completed sale.
UPDATE "lead" l SET "last_visit_at" = sub.last_visit_at
FROM (
  SELECT lead_id, MAX(ts) AS last_visit_at FROM (
    SELECT "lead_id", "start_date" AS ts FROM "appointment" WHERE "status" = 'completed'
    UNION ALL
    SELECT "lead_id", "completed_at" AS ts FROM "sale"
      WHERE "status" = 'completed' AND "completed_at" IS NOT NULL AND "lead_id" IS NOT NULL
  ) visits
  GROUP BY lead_id
) sub
WHERE l."id" = sub.lead_id;
--> statement-breakpoint

-- 4. lifetime_spend_cents = sum of completed sale totals.
UPDATE "lead" l SET "lifetime_spend_cents" = sub.total
FROM (
  SELECT "lead_id", SUM("total_cents")::int AS total FROM "sale"
  WHERE "status" = 'completed' AND "lead_id" IS NOT NULL
  GROUP BY "lead_id"
) sub
WHERE l."id" = sub.lead_id;
--> statement-breakpoint

-- 5. Anyone who converted is a customer: promote to 'booked' unless they are
--    'lost' (a lead who once transacted but is now dead stays lost).
UPDATE "lead" SET "status" = 'booked'
WHERE "converted_at" IS NOT NULL AND "status" NOT IN ('booked', 'lost');
