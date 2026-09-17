-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Availability consolidation — backfill practitioner_unavailability → blocked_time
-- ============================================================================
-- The practitioner_unavailability system is retired: all availability readers
-- and the mobile "block time off" writers now use blocked_time. This migration
-- copies any existing unavailability rows into the blocked_time family so no
-- block is lost. The practitioner_unavailability tables are dropped in the
-- following migration.
--
-- Mapping (the unavailability id is REUSED as the blocked_time id so exceptions
-- link up without a lookup table):
--   practitioner_unavailability            → blocked_time (paid = false, ad-hoc)
--   practitioner_unavailability.practitioner_id NOT NULL
--                                          → blocked_time_practitioner join row
--   practitioner_unavailability.practitioner_id NULL (org-wide)
--                                          → no join row (org-wide semantics)
--   practitioner_unavailability_exception  → blocked_time_exception
--
-- Idempotent: ON CONFLICT DO NOTHING on every insert, so re-running is a no-op.
-- ============================================================================

INSERT INTO blocked_time (
  id, organization_id, blocked_time_type_id, title, description,
  start_date, end_date, all_day, timezone, rrule, recurrence_end_date,
  paid, created_by_id, created_at, updated_at
)
SELECT
  pu.id, pu.organization_id, NULL, pu.title, pu.description,
  pu.start_date, pu.end_date, pu.all_day, pu.timezone, pu.rrule, pu.recurrence_end_date,
  false, pu.created_by_id, pu.created_at, pu.updated_at
FROM practitioner_unavailability pu
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO blocked_time_practitioner (id, blocked_time_id, practitioner_id, created_at)
SELECT
  'btp_' || pu.id, pu.id, pu.practitioner_id, pu.created_at
FROM practitioner_unavailability pu
WHERE pu.practitioner_id IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint

INSERT INTO blocked_time_exception (
  id, blocked_time_id, original_start, cancelled,
  start_date, end_date, title, description, created_at, updated_at
)
SELECT
  pue.id, pue.unavailability_id, pue.original_start, pue.cancelled,
  pue.start_date, pue.end_date, pue.title, pue.description, pue.created_at, pue.updated_at
FROM practitioner_unavailability_exception pue
ON CONFLICT DO NOTHING;
