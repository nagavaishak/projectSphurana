-- Custom SQL migration file, put your code below! --

-- ============================================================================
-- app_public read grants for the tables the public pages actually read
-- ============================================================================
-- `app_public` is the least-privilege role behind the UNAUTHENTICATED public
-- surface (booking form, venue page, manage-appointment link, intake form). It
-- has NO `ALTER DEFAULT PRIVILEGES` — 0049_rls_roles.sql:81 grants future
-- tables to app_authenticated/app_system ONLY — so every table it may touch
-- needs an explicit GRANT, forever. A new table on a public read path is
-- therefore silently un-grantable-by-default, which is exactly how the eight
-- tables below shipped with a policy and no privilege.
--
-- Their RLS policies already name app_public (org_isolation /
-- child_org_isolation / join_org_isolation all default `to:
-- [appAuthenticated, appPublic]`); this migration adds the table-level
-- privilege those policies assume. A policy without a grant is not a partial
-- permission — it is `permission denied`, which the booking/venue services
-- surface as a 500 the moment `RLS_ENABLED` flips on.
--
-- Why this was invisible until now: `withPublicOrgScope` is called with
-- `{ db }` at every one of these call sites, so with the flag OFF the injected
-- (owner) connection is used and the missing privilege never bites. The gap is
-- latent, not dormant — it becomes a total outage of the public pages at the
-- flip, not a degradation.
--
-- The set below is DERIVED, not guessed: `scripts/rls/check-rls-coverage.mjs`
-- now walks every `withPublicOrgScope` callback in packages/features and the
-- helpers they call, collects the tables reached, and fails when one has no
-- app_public grant. Re-run `pnpm rls:check-coverage` after touching a public
-- read path.
--
-- Privileges are per-table minimums (SELECT unless the public path writes).
-- Idempotent: GRANT is a no-op if already held. Safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Location dimension — the branch-scoped catalogue and its per-branch prices
-- ---------------------------------------------------------------------------
-- Both public read paths resolve a branch and then price against it:
--   get-general-booking-config.service.ts (atLocationOrUnassigned +
--     loadServiceLocationOverrides + loadVariantLocationOverrides)
--   get-venue-config.service.ts (same three)
--
-- Without these three grants the public pages do not fall back to org pricing —
-- they fail outright, because the join is in the WHERE clause of the service
-- list itself.
GRANT SELECT ON organization_service_variant         TO app_public;--> statement-breakpoint
GRANT SELECT ON organization_service_location         TO app_public;--> statement-breakpoint
GRANT SELECT ON organization_service_variant_location TO app_public;--> statement-breakpoint

-- NOT granted — `product_location`, `membership_plan_location` and
-- `offer_location` are the other three location join tables and they are
-- deliberately absent. No public read path reaches them: products, membership
-- plans and offers are read only by authenticated dashboard services
-- (list-offers, get-offer, list-products, …). Granting them "for symmetry"
-- would widen the anonymous role's surface for a caller that does not exist.
-- Add them here in the same commit as the public code that needs them.

-- ---------------------------------------------------------------------------
-- 2. Venue page display data
-- ---------------------------------------------------------------------------
-- organization_photo — the branch gallery + the org-wide fallback photos
--   (get-venue-config.service.ts). Public-facing content by definition: url,
--   caption, sort_order, is_cover.
--
-- organization_service_category — the org's real category names, which drive
--   the chips on the venue and booking pages (loadServiceCategoryNames).
GRANT SELECT ON organization_photo            TO app_public;--> statement-breakpoint
GRANT SELECT ON organization_service_category TO app_public;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Public booking write path — appointment line items
-- ---------------------------------------------------------------------------
-- submit-general-booking.service.ts persists the cart as `appointment_service`
-- rows inside the SAME transaction as the appointment. app_public already holds
-- SELECT/INSERT/UPDATE on `appointment` (0049); the child rows were missed, so
-- a multi-service public booking would abort the whole transaction.
--
-- INSERT is safe for the same reason it is on `appointment`: the
-- child_org_isolation policy's WITH CHECK ties the row to an appointment in
-- `app.current_org_id`, so a tampered payload cannot write into another org.
GRANT SELECT, INSERT ON appointment_service TO app_public;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Token-addressed public flows
-- ---------------------------------------------------------------------------
-- appointment_manage_token — SELECT only. resolve-manage-token.ts looks a row
--   up by (organization_id, token_hash) to authorise the cancel/reschedule
--   links in customer emails. The row holds a hash and an expiry, nothing
--   reversible; the write side (issuing tokens) is an authenticated/system
--   action and is deliberately NOT granted.
--
-- intake_submission — SELECT (resolve-intake-token.ts, by token_hash) and
--   UPDATE (submit-intake-form.service.ts writes answers/status/completed_at,
--   guarded on status = 'pending' so two concurrent submits cannot both win).
--   INSERT and DELETE are NOT granted: submissions are created by the clinic.
--
--   ⚠️ FOLLOW-UP — this is TABLE-level SELECT, i.e. every column, including
--   `answers` and `fields_snapshot`, which hold the customer's intake
--   responses. That is the same shape 0090 and 0135 narrowed elsewhere, and it
--   should be narrowed here too. It is not narrowed in THIS migration because
--   `resolveIntakeToken` uses `findFirst` (which emits `select *`): a column
--   grant would break the read until that service selects an explicit column
--   list. Do both in one commit — see 0090's note: keep the grant and the
--   select in step, because a mismatch surfaces as "permission denied for
--   column …" at runtime, not at build time.
GRANT SELECT ON appointment_manage_token TO app_public;--> statement-breakpoint
GRANT SELECT, UPDATE ON intake_submission TO app_public;
