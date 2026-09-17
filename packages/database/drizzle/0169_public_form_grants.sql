-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Carry the public intake page's column grants across to the unified form
-- tables.
-- ============================================================================
-- 0166 created `form_submission` with an `org_isolation` policy that names
-- `app_public` — the role behind the UNAUTHENTICATED intake page — but gave
-- that role no GRANT. A policy without a grant is DEAD: the read fails
-- `permission denied for table` before the policy is ever evaluated, and the
-- table simply looks empty. That is ENG-647 on `patient_auth` repeating itself,
-- and it is the third time in this schema.
--
-- Harmless today — RLS_ENABLED is pinned off in production (#506) and there
-- are zero intake rows — but it MUST land before the flip, because the failure
-- is a runtime "permission denied", never a build error.
--
-- This mirrors drizzle/0157_narrow_public_intake_grants.sql column for column;
-- read that file for the reasoning behind each inclusion. Two differences:
--
--   · `intake_form_id` becomes `form_id`.
--   · `kind` joins the SELECT grant. Postgres requires the privilege on every
--     column a statement TOUCHES, predicates included, and every intake query
--     now filters `kind = 'intake'` so it never sees consent rows or notes.
--
-- `form` itself gets a NARROW select — the page shows the form's name above
-- the questions. Withheld: `fields` (the submission carries its own frozen
-- `fields_snapshot`), and everything about visibility or signature policy.
--
-- Same rule as 0090 and 0157: KEEP THE SELECT LIST AND THE GRANT IN STEP. The
-- column list lives in PUBLIC_SUBMISSION_COLUMNS in
-- packages/features/src/intake-forms/shared/resolve-intake-token.ts.
--
-- Idempotent: REVOKE of an absent privilege and GRANT of a held one are both
-- no-ops. Safe to re-run.
-- ============================================================================

-- SELECT — withheld: lead_id and appointment_id (the pivots into the client's
-- wider file — a bearer link to one form is not a licence to enumerate their
-- record), patient_visibility, sent_at, reminder_sent_at, completed_at,
-- created_at, updated_at.
REVOKE SELECT ON form_submission FROM app_public;--> statement-breakpoint
GRANT SELECT (
  id,
  organization_id,
  form_id,
  kind,
  status,
  token_hash,
  fields_snapshot,
  answers
) ON form_submission TO app_public;--> statement-breakpoint

-- UPDATE — the submit path writes exactly these four. Withheld: everything
-- that would re-parent the submission (lead_id, form_id, appointment_id,
-- organization_id, kind) or forge its provenance (token_hash, sent_at).
REVOKE UPDATE ON form_submission FROM app_public;--> statement-breakpoint
GRANT UPDATE (
  answers,
  status,
  completed_at,
  updated_at
) ON form_submission TO app_public;--> statement-breakpoint

-- The template, read only for its name. NOT `fields` — the submission froze
-- its own copy at send time, and that is the one the patient must be shown.
REVOKE SELECT ON form FROM app_public;--> statement-breakpoint
GRANT SELECT (
  id,
  organization_id,
  kind,
  name,
  description
) ON form TO app_public;
