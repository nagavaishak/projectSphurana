-- ============================================================================
-- app_public: the ONE column of `org_defaults` the public booking path reads.
--
-- `allocate-appointment-resources.ts` calls `resolveResourceAssignmentMode()`,
-- which reads `org_defaults.resource_assignment_mode` to decide whether the
-- allocator auto-assigns a room or leaves it to a human. That runs inside the
-- PUBLIC booking write path (an online booking allocates its room), so it
-- executes as `app_public` once `RLS_ENABLED` is on.
--
-- `app_public` has NO `ALTER DEFAULT PRIVILEGES` — 0049_rls_roles.sql grants
-- future tables to app_authenticated/app_system ONLY — so every table a public
-- path touches needs an explicit grant, forever. `org_defaults` predates the
-- resource work and had no reason to be reachable anonymously until the rooms
-- allocator started consulting it; the coverage lint
-- (`scripts/rls/check-rls-coverage.mjs`) caught it.
--
-- GRANT is checked BEFORE row-level security, so without this the read fails at
-- the privilege check with `permission denied for table org_defaults` — not a
-- filtered read. Latent only while the flag is off: `withPublicOrgScope` passes
-- through the injected owner connection today, so this becomes a 500 on every
-- online booking at the flip, not a degradation.
--
-- COLUMN LIST, not the table. `org_defaults` is the org's private configuration
-- drawer: ad daily budget, ad objective, brand voice, wage auto-clock-in and
-- automated-break rules, gift-card presets. None of that belongs to an
-- anonymous customer booking a haircut, and a table grant would hand over all
-- of it to satisfy one enum column.
--
-- `organization_id` is granted because Postgres requires the privilege on every
-- column a statement TOUCHES, predicates included — it is the WHERE clause here
-- and is never read back. Same rule as 0090 and 0157: keep the grant and the
-- `select` in step, because a mismatch surfaces as "permission denied for
-- column …" at RUNTIME, never at build time, and only once RLS_ENABLED is on.
-- `resolveResourceAssignmentMode` uses an explicit `columns:` list rather than
-- `findFirst`'s default `select *`, which is what makes a column grant viable
-- at all.
--
-- Idempotent: GRANT of a held privilege is a no-op. Safe to re-run.
-- ============================================================================

GRANT SELECT (
  organization_id,
  resource_assignment_mode
) ON org_defaults TO app_public;
