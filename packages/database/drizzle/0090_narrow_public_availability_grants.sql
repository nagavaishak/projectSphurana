-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Narrow the public booking widget's read of the scheduling tables to the
-- columns it actually needs.
-- ============================================================================
-- 0064 granted `app_public` — the role behind the UNAUTHENTICATED booking
-- widget — table-level SELECT on time_off / blocked_time /
-- blocked_time_exception so `resolveAvailability` could compute busy intervals.
-- Table-level SELECT is EVERY column, which handed the public internet:
--
--   time_off.type          -- enum incl. 'sick_leave' => staff health data
--   time_off.description   -- free text, may carry medical detail
--   blocked_time.title     -- free text, e.g. "Dr Ryan - hospital appointment"
--   blocked_time.description
--   blocked_time_exception.title / .description   -- same, per-occurrence
--
-- None of it is needed to answer "is this practitioner busy at 14:00?" — only
-- the time fields are. RLS scoped these reads to the correct ORG; it never
-- restricted which COLUMNS came back, so anything able to reach the widget's
-- data path could read that org's staff sick-leave and free-text notes.
--
-- The resolver now selects an explicit column list instead of select(*)
-- (resolve-availability.service.ts + expandBlockedTimeBusy), so these narrowed
-- grants are sufficient. KEEP THE TWO IN STEP: re-widening a select without a
-- matching grant surfaces as "permission denied", which the booking service
-- swallows into an EMPTY-SLOTS result rather than a visible error.
--
-- shift / blocked_time_practitioner keep table-level SELECT: pure scheduling and
-- join data (ids, day-of-week, minutes) with nothing personal in it.
--
-- Idempotent: REVOKE of an absent privilege and GRANT of a held one are both
-- no-ops. Safe to re-run.
-- ============================================================================

-- time_off — withheld: type ('sick_leave'), description, all_day,
-- created_by_id, timestamps.
REVOKE SELECT ON time_off FROM app_public;--> statement-breakpoint
GRANT SELECT (
  organization_id,
  practitioner_id,
  start_date,
  end_date,
  rrule,
  timezone,
  recurrence_end_date,
  approved
) ON time_off TO app_public;--> statement-breakpoint

-- blocked_time — withheld: title, description, blocked_time_type_id, all_day,
-- paid, created_by_id, timestamps.
REVOKE SELECT ON blocked_time FROM app_public;--> statement-breakpoint
GRANT SELECT (
  id,
  organization_id,
  start_date,
  end_date,
  rrule,
  timezone,
  recurrence_end_date
) ON blocked_time TO app_public;--> statement-breakpoint

-- blocked_time_exception — withheld: title, description, timestamps.
REVOKE SELECT ON blocked_time_exception FROM app_public;--> statement-breakpoint
GRANT SELECT (
  blocked_time_id,
  original_start,
  start_date,
  end_date,
  cancelled
) ON blocked_time_exception TO app_public;
