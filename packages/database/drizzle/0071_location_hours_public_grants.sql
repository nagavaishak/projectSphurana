-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Public booking — app_public read grants for location opening hours
-- ============================================================================
-- The public booking widget (app_public role) resolves availability from the
-- location's opening hours + per-date exceptions, and already reads
-- practitioner_location working hours. Their RLS policies already scope to
-- app_public; this adds the missing table-level SELECT grants so those reads
-- succeed instead of failing "permission denied" (which the booking service
-- swallows into an empty-slots result).
--
-- Read-only: app_public never writes location/opening-hours data.
-- Idempotent: GRANT is a no-op if already granted.
-- ============================================================================

GRANT SELECT ON organization_location                  TO app_public;--> statement-breakpoint
GRANT SELECT ON org_location_opening_hours_exception    TO app_public;--> statement-breakpoint
GRANT SELECT ON practitioner_location                   TO app_public;
