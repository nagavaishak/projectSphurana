-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Prevent online double-booking via a partial GiST exclusion constraint
-- ============================================================================
-- Online booking paths (booking_form, ai_voice_caller) insert appointments with
-- allow_double_booking = false. This constraint guarantees at the DB level that
-- two such rows can never overlap in time for the same practitioner — closing
-- the check-then-insert (TOCTOU) race that the application-layer availability
-- check cannot win under concurrency (READ COMMITTED takes no predicate lock on
-- an absent row, so two concurrent online bookings could both "see free" and
-- both insert).
--
-- Manual/console bookings set allow_double_booking = true and are therefore
-- EXCLUDED from this constraint — staff keep full Fresha-style freedom to stack
-- appointments at the same time. Online availability still hides taken slots
-- regardless of source (the resolver counts every active appointment), so this
-- is purely the write-side backstop.
--
-- tstzrange defaults to '[)' (half-open), matching the app overlap test
-- (start < otherEnd AND end > otherStart): back-to-back appointments where one
-- ends exactly as the next starts do NOT conflict.
-- ============================================================================

-- btree_gist provides the equality operator class needed to combine
-- practitioner_id (=) with a range (&&) in a single GiST exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint

-- Grandfather all pre-existing appointments: they predate this policy and may
-- contain historical (manual) overlaps that would make the constraint fail to
-- build. Marking them allow_double_booking = true removes them from the
-- constraint's partial index so creation is guaranteed to succeed. New online
-- overlaps are still fully prevented, and new-vs-legacy overlaps remain blocked
-- by the application-layer availability check.
UPDATE "appointment" SET "allow_double_booking" = true;--> statement-breakpoint

ALTER TABLE "appointment"
  ADD CONSTRAINT "appointment_no_overlap"
  EXCLUDE USING gist (
    "practitioner_id" WITH =,
    tstzrange("start_date", "end_date") WITH &&
  )
  WHERE (
    "practitioner_id" IS NOT NULL
    AND "deleted_at" IS NULL
    AND "allow_double_booking" = false
    AND "status" IN ('booked', 'confirmed', 'arrived', 'started')
  );
