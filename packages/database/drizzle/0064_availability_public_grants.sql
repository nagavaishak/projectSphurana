-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Availability consolidation — app_public read grants for the scheduling model
-- ============================================================================
-- The unified availability resolver (`resolveAvailability`) is now the single
-- source of truth for bookable time, including the PUBLIC booking widget, which
-- runs as the least-privilege `app_public` role. The resolver reads the
-- scheduling tables (shifts, time off, blocked time) that the old booking path
-- never touched, so app_public must be granted SELECT on them.
--
-- RLS policies already exist on all of these (org_isolation / join_org_isolation
-- / child_org_isolation, all scoped TO app_public) — this migration only adds
-- the table-level GRANT that the policies assume. Without the GRANT, app_public
-- hits "permission denied" and the public booking form returns zero slots.
--
-- Read-only: app_public never writes scheduling data (staff manage shifts /
-- blocks in the authenticated app as app_authenticated).
--
-- Idempotent: GRANT is a no-op if already granted; safe to re-run.
-- ============================================================================

GRANT SELECT ON shift                      TO app_public;--> statement-breakpoint
GRANT SELECT ON time_off                   TO app_public;--> statement-breakpoint
GRANT SELECT ON blocked_time               TO app_public;--> statement-breakpoint
GRANT SELECT ON blocked_time_practitioner  TO app_public;--> statement-breakpoint
GRANT SELECT ON blocked_time_exception     TO app_public;
