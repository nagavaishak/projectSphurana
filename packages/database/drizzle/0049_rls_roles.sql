-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- RLS Foundation — process-separated Postgres roles (Phase 0 / F2)
-- ============================================================================
-- Creates the three runtime roles RLS depends on. This migration is INERT for
-- application behavior: it only provisions roles + grants. RLS itself is not
-- enabled here (no ENABLE ROW LEVEL SECURITY, no policies — those land in the
-- single policy migration emitted by Phase 2 / I1). The app keeps connecting as
-- the owner until the role switch (Phase 2 / I3) + `RLS_ENABLED` flip.
--
-- Roles (see docs/rls/rls-implementation-plan.md §0):
--   app_authenticated  LOGIN, NOBYPASSRLS  — public API (subject, cannot bypass)
--   app_public         LOGIN, NOBYPASSRLS  — open booking (least-privilege; its
--                                            table grants are added by W-BOOK)
--   app_system         LOGIN, BYPASSRLS    — worker / webhook-router (cross-org)
--
-- Passwords are NEVER in VCS. Roles are created passwordless (LOGIN attribute
-- but no password); a per-env provisioning step (Phase 2 / I2) sets passwords
-- from secrets via `ALTER ROLE … PASSWORD`. A passwordless LOGIN role cannot
-- actually authenticate over the network, so this is safe to ship.
--
-- Idempotent: every statement is safe to re-run (CREATE guarded by a pg_roles
-- check; ALTER/GRANT/REVOKE are naturally idempotent). Re-running is a no-op.
-- Portable: vanilla Postgres only — no Neon Authorize, no pg_session_jwt.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Create roles (guarded so re-running does not error)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_authenticated') THEN
    CREATE ROLE app_authenticated LOGIN NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_public') THEN
    CREATE ROLE app_public LOGIN NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_system') THEN
    CREATE ROLE app_system LOGIN BYPASSRLS;
  END IF;
END
$$;

-- Enforce the attributes we actually depend on, idempotently. We assert ONLY
-- LOGIN + (NO)BYPASSRLS, NOT NOSUPERUSER/NOCREATEDB/NOCREATEROLE, because:
--   1. CREATE ROLE already defaults to NOSUPERUSER/NOCREATEDB/NOCREATEROLE, so
--      re-asserting them is redundant for a fresh install, and
--   2. on Neon the migration runs as neondb_owner, which inherits neon_superuser
--      (enough to CREATE roles and set BYPASSRLS) but is NOT a true SUPERUSER —
--      and "ALTER ROLE … NOSUPERUSER" requires the SUPERUSER attribute even to
--      set it to its current value ("permission denied to alter role", SQLSTATE
--      42501). NOCREATEDB likewise needs CREATEDB. So we don't touch them.
-- Setting BYPASSRLS is allowed because neondb_owner has BYPASSRLS via inheritance.
ALTER ROLE app_authenticated LOGIN NOBYPASSRLS;
ALTER ROLE app_public        LOGIN NOBYPASSRLS;
ALTER ROLE app_system        LOGIN BYPASSRLS;

-- ---------------------------------------------------------------------------
-- 2. Lock down PUBLIC (defense-in-depth)
-- ---------------------------------------------------------------------------
-- Strip the implicit privileges every role would otherwise inherit via PUBLIC,
-- so a role only has what we GRANT it explicitly below.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- 3. app_authenticated — DML on every current table + future tables
-- ---------------------------------------------------------------------------
-- The public API surface. RLS policies (added later) are what actually scope
-- its reads/writes to the active org; the GRANT just lets it issue DML at all.
GRANT USAGE ON SCHEMA public TO app_authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_authenticated;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_authenticated;

-- Future tables/sequences created by the migration owner inherit these grants,
-- so a new table is not silently inaccessible (it will still need a policy —
-- the W-CI coverage lint enforces that separately).
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_authenticated;

-- ---------------------------------------------------------------------------
-- 4. app_public — least-privilege; Bucket C booking tables only (W-BOOK)
-- ---------------------------------------------------------------------------
-- This role connects exclusively from the public booking route group
-- (apps/api/src/booking-forms/public-booking.controller.ts). A fully-
-- compromised public endpoint can therefore touch ONLY the tables granted here.
--
-- Grant rationale (Bucket C — docs/rls/table-inventory.md):
--
--   organization          SELECT — slug-bootstrap: resolve slug → org_id before
--                                  org context is established (slug_bootstrap
--                                  policy). Also read org name/logo for the page.
--
--   organization_service  SELECT — list active services on the booking page.
--
--   practitioner          SELECT — show bookable practitioners; resolve
--                                  practitioner org membership.
--
--   practitioner_service  SELECT — join table: which practitioners offer which
--                                  services (slot computation).
--
--   calendar_account      SELECT — read Google Calendar credentials to compute
--                                  busy/free slots. Credentials are encrypted in
--                                  the column; app_public can read the ciphertext
--                                  but cannot decrypt without the app secret.
--
--   appointment           SELECT  — conflict check before INSERT (isPractitionerAvailable).
--                         INSERT  — create the booking row.
--                         UPDATE  — back-fill externalCalendarEventId after GCal
--                                   sync (fire-and-forget in submitGeneralBooking).
--                         WITH CHECK enforced by org_isolation policy:
--                           organization_id = current_setting('app.current_org_id', true)
--                         A tampered organizationId in the payload therefore
--                         cannot write into another org's appointments.
--
--   member                SELECT — resolve owner/assignee for new appointments.
--
--   lead                  SELECT  — look up an existing lead by email to avoid
--                                   duplicates.
--                         INSERT  — create the lead row for a new booking.
--                         WITH CHECK enforced by org_isolation policy (same as above).
--
-- NOT granted (explicit exclusion decisions):
--
--   appointment_deposit — deposit creation is triggered by an authenticated
--     owner action AFTER a booking lands; the unauthenticated booking form does
--     not initiate Stripe checkout sessions. No write path exists in the public
--     flow. If deposit link collection is added to the public form in the future,
--     add INSERT here AND review the policy.
--
--   booking_account — third-party booking platform accounts (Calendly, Timely,
--     etc.) contain encrypted OAuth tokens. The public booking flow does not
--     need to read or write these; availability is computed from calendar_account
--     (Google Calendar) or org.businessHours. NOT granted.
--
--   All other Bucket A / B / non-booking tables — not granted. An attacker
--     connecting as app_public will receive `permission denied` for any table
--     outside this list (e.g. payment, video, meta_ad, graphic, …).
--
-- Sequence grants are required for INSERT to appointment + lead so that their
-- auto-increment / cuid2-backed sequences can advance. (Most IDs are
-- application-generated via createId()/randomUUID(), but pg sequences are
-- named after the table and Postgres requires USAGE + SELECT on them for any
-- INSERT regardless of how the id is generated when a DEFAULT clause exists.)
-- GRANT USAGE + SELECT on the specific sequences rather than ALL to stay
-- minimal.
--
-- All statements are idempotent (GRANT is a no-op if already granted).
GRANT USAGE ON SCHEMA public TO app_public;

-- Read-only tables: organization config, services, practitioners, calendar
GRANT SELECT ON organization         TO app_public;
GRANT SELECT ON organization_service TO app_public;
GRANT SELECT ON practitioner         TO app_public;
GRANT SELECT ON practitioner_service TO app_public;
GRANT SELECT ON calendar_account     TO app_public;
GRANT SELECT ON member               TO app_public;

-- appointment: SELECT (conflict check) + INSERT (create booking) + UPDATE
-- (back-fill calendar event id after GCal sync)
GRANT SELECT, INSERT, UPDATE ON appointment TO app_public;

-- lead: SELECT (dedup lookup) + INSERT (create new lead)
GRANT SELECT, INSERT ON lead TO app_public;

-- Sequence grants so INSERT can advance the default nextval() if used.
-- appointment and lead use application-generated IDs but we grant defensively
-- in case Postgres requires sequence permission for the INSERT path.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_public;

-- ---------------------------------------------------------------------------
-- 5. app_system — DML everywhere; bypasses RLS (cross-org by design)
-- ---------------------------------------------------------------------------
-- Worker, webhook-router, webhooks, cron, seeders. BYPASSRLS (set above) lets
-- it read/write across orgs; it still needs the table grants to issue DML.
GRANT USAGE ON SCHEMA public TO app_system;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO app_system;
GRANT USAGE, SELECT                  ON ALL SEQUENCES IN SCHEMA public TO app_system;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_system;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO app_system;
