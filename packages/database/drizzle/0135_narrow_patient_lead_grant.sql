-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- Narrow the patient portal's read of `lead` to the columns it actually needs.
-- ============================================================================
-- 0130 granted `app_patient` — the role behind the signed-in CUSTOMER —
-- table-level SELECT on `lead` so `getCurrentPatient` could read the person's
-- own record. Table-level SELECT is EVERY column, which handed the customer:
--
--   lead.notes                     -- STAFF-INTERNAL clinical commentary,
--                                  -- written on the assumption that no
--                                  -- customer would ever read it
--   lead.metadata                  -- jsonb, arbitrary internal shape
--   lead.tags                      -- internal segmentation
--   lead.human_takeover_requested  -- chatbot escalation state
--   lead.status / .source / ...    -- CRM funnel position
--
-- The portal is built around `lead.portal_note` being a SEPARATE column from
-- `lead.notes` precisely so the two cannot leak into each other by a filter
-- slip (see 0134). That argument only holds at the application layer while the
-- grant permits the whole row: one `select *`, one DTO spread, or one debug
-- log in a future portal endpoint publishes staff commentary to the person it
-- describes — and RLS is no backstop, because a policy filters ROWS. The
-- GRANT is what decides columns.
--
-- Mirrors 0090, which narrowed `app_public`'s availability reads for the same
-- reason. As there: KEEP THE GRANT AND THE SELECT IN STEP. `getCurrentPatient`
-- now selects an explicit column list instead of `findFirst` (which emits
-- `select *`); re-widening that select without widening this grant surfaces as
-- "permission denied for column ..." at runtime.
--
-- Withheld on purpose. If the portal ever genuinely needs one of these, add it
-- here in the same commit as the code that reads it.
--
-- Idempotent: REVOKE of an absent privilege and GRANT of a held one are both
-- no-ops. Safe to re-run.
-- ============================================================================

REVOKE SELECT ON "lead" FROM app_patient;--> statement-breakpoint
GRANT SELECT (
  id,
  organization_id,
  first_name,
  last_name,
  email,
  phone,
  portal_note
) ON "lead" TO app_patient;
