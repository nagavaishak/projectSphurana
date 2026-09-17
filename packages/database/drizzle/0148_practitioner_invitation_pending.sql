-- ENG-794 — invited team members are treated as active, bookable practitioners.
--
-- "Add team member" creates the practitioner row FIRST and the invitation LAST.
-- The row lands with is_active = true, accepts_bookings = true and a seeded
-- 09:00-17:00 weekly shift, and because shifts are the sole source of working
-- time, an invitee who has never opened the email is immediately a full
-- calendar column with real availability: selectable as the practitioner on a
-- staff booking, and offered to customers on the public booking page.
--
-- `invitation_pending` is the missing state. Only the invite flow sets it;
-- accepting the invitation clears it. It deliberately does NOT reuse
-- `is_active` (which means "still employed" and drives the Active/Inactive
-- badge) and is not derived from `user_id IS NULL` (which is also true of every
-- practitioner the onboarding wizard added without ever emailing them — gating
-- on that would have silently made those people unbookable).
ALTER TABLE "practitioner"
  ADD COLUMN "invitation_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- Backfill the rows the bug already produced.
--
-- The narrowest possible predicate for "invited, never accepted": no linked
-- user account AND an invitation still sitting at `pending` for the same
-- address in the same org. A practitioner added during onboarding has no
-- invitation row and is therefore untouched, which is the whole point of not
-- keying this off `user_id` alone.
UPDATE "practitioner" p
SET "invitation_pending" = true
WHERE p."user_id" IS NULL
  AND p."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "invitation" i
    WHERE i."organization_id" = p."organization_id"
      AND lower(i."email") = lower(p."email")
      AND i."status" = 'pending'
      AND i."expires_at" > now()
  );
