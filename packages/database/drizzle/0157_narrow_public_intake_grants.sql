-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Narrow the public intake form's read/write of `intake_submission` to the
-- columns it actually needs.
-- ============================================================================
-- This is the ⚠️ FOLLOW-UP that 0156_app_public_read_grants.sql flagged and
-- deliberately did not do. 0156 gave `app_public` — the role behind the
-- UNAUTHENTICATED intake page — TABLE-level SELECT and UPDATE on
-- `intake_submission`, because `resolveIntakeToken` used `findFirst`, which
-- emits `select *`; a column grant would have broken the read on day one.
--
-- Table-level SELECT is EVERY column, which handed the anonymous role more of
-- the submission than the page has any use for:
--
--   lead_id         -- the pivot into the client's wider file
--   appointment_id  -- ditto, into their booking history
--   sent_at, created_at, updated_at
--
-- and table-level UPDATE is every column, i.e. the ability to re-point a
-- submission at a DIFFERENT lead, form or appointment — a far bigger write than
-- "record this patient's answers".
--
-- `resolveIntakeToken` now selects an explicit column list
-- (PUBLIC_SUBMISSION_COLUMNS in
-- packages/features/src/intake-forms/shared/resolve-intake-token.ts), so the
-- narrowed grants are sufficient. Same rule as 0090:
-- KEEP THE TWO IN STEP. A select widened without a matching grant fails at
-- RUNTIME with `permission denied for column …`, never at build time, and only
-- once RLS_ENABLED is on.
--
-- What is NOT narrowed away, and why: `fields_snapshot` and `answers` stay in
-- the SELECT list. The intake page's entire job is to render the frozen
-- questions and — for a completed form — show the patient what they signed. The
-- control on that data is the bearer token plus org_isolation, not the grant.
-- This migration removes the columns the page never needed; it does not pretend
-- to remove the ones it does.
--
-- Column-privilege notes:
--   · Postgres requires the privilege on every column a statement TOUCHES,
--     predicates included. `token_hash` is therefore in the SELECT grant even
--     though no caller ever reads it back — it is the lookup's WHERE clause.
--   · `completed_at` is the mirror case: written by the submit path, never read
--     by it, so it carries UPDATE without SELECT.
--   · `updated_at` is in the UPDATE grant because drizzle's `$onUpdate` puts it
--     in the SET clause of every `.update().set()` on this table, whether the
--     service names it or not.
--   · UPDATE's WHERE clause (id, organization_id, status) needs SELECT, not
--     UPDATE, on those columns — and has it.
--
-- Idempotent: REVOKE of an absent privilege and GRANT of a held one are both
-- no-ops. Safe to re-run.
-- ============================================================================

-- SELECT — withheld: lead_id, appointment_id, sent_at, completed_at,
-- created_at, updated_at.
REVOKE SELECT ON intake_submission FROM app_public;--> statement-breakpoint
GRANT SELECT (
  id,
  organization_id,
  intake_form_id,
  status,
  token_hash,
  fields_snapshot,
  answers
) ON intake_submission TO app_public;--> statement-breakpoint

-- UPDATE — the submit path writes exactly these four. Withheld: everything that
-- would re-parent the submission (lead_id, intake_form_id, appointment_id,
-- organization_id) or forge its provenance (token_hash, sent_at, created_at).
REVOKE UPDATE ON intake_submission FROM app_public;--> statement-breakpoint
GRANT UPDATE (
  answers,
  status,
  completed_at,
  updated_at
) ON intake_submission TO app_public;
