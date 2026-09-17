import { type SQL, Table, getTableName, is, sql } from 'drizzle-orm';
import { PgPolicy, type PgTable, pgPolicy, pgRole } from 'drizzle-orm/pg-core';

/**
 * RLS policy helpers for schema files.
 *
 * These let each org-scoped table declare its isolation policy in ONE line, so
 * the 56 org tables stay consistent and the parallel Phase 1 workstreams are
 * trivial (and impossible to get subtly wrong). See
 * docs/rls/rls-implementation-plan.md §2 and docs/rls/CONVENTIONS.md.
 *
 * IMPORTANT: the roles below are declared `.existing()` — drizzle never creates
 * or drops them. They are provisioned by the hand-written roles migration
 * (drizzle/0049_rls_roles.sql), and drizzle.config sets `entities.roles: false`
 * so drizzle-kit ignores role objects entirely.
 */

/** Public API surface — subject to RLS, cannot bypass. */
export const appAuthenticated = pgRole('app_authenticated').existing();

/** Open booking flow — least-privilege, subject to RLS. */
export const appPublic = pgRole('app_public').existing();

/** Worker / webhook-router / system — BYPASSRLS (declared for completeness; it
 * is not referenced by org policies because it bypasses them). */
export const appSystem = pgRole('app_system').existing();

/**
 * Patient portal sessions (ENG-647) — the clinic's CUSTOMER, signed into the
 * patient portal. Least-privilege like `app_public`, but with a persisted
 * identity: `withPatientScope` sets `app.current_patient_lead_id` and the
 * `patient_self` policies below scope every read to that one person's rows.
 * Provisioned by drizzle/<n>_patient_portal_role.sql, not by drizzle-kit.
 */
export const appPatient = pgRole('app_patient').existing();

/**
 * The org-isolation predicate, shared by USING (reads) and WITH CHECK (writes):
 * a row is visible/writable only when its `organization_id` matches the org set
 * for the current transaction via `SET LOCAL app.current_org_id`.
 *
 * Fail-closed: outside a `withOrgScope`/`withPublicOrgScope` transaction the
 * setting is unset, so `current_setting(…, true)` returns NULL, the comparison
 * is NULL, and ZERO rows match — an empty result, never a cross-org leak.
 */
const ORG_ISOLATION_PREDICATE = sql`organization_id = current_setting('app.current_org_id', true)`;

/**
 * Standard org-isolation policy for a table with an `organization_id` column.
 *
 * Returns a permissive `FOR ALL` policy, scoped to `app_authenticated` and
 * `app_public`, that both filters reads and (via WITH CHECK) prevents writing a
 * row into another org even with a tampered `organization_id` in the payload.
 * Linking it to the table also enables RLS on that table when drizzle-kit
 * generates the migration.
 *
 * Usage in a schema file (one line, exported so drizzle-kit sees it):
 *
 * ```ts
 * export const lead = pgTable('lead', { … });
 * export const leadRlsPolicy = orgRlsPolicy(lead);
 * ```
 *
 * Do NOT run `db:generate` in a workstream — Phase 2 / I1 emits the single
 * policy migration for all tables at once.
 */
export function orgRlsPolicy(table: PgTable) {
  return pgPolicy('org_isolation', {
    as: 'permissive',
    for: 'all',
    to: [appAuthenticated, appPublic],
    using: ORG_ISOLATION_PREDICATE,
    withCheck: ORG_ISOLATION_PREDICATE,
  }).link(table);
}

// =============================================================================
// B1 — Child-of-org helpers
// =============================================================================

/**
 * The correlated EXISTS predicate shared by `childOrgRlsPolicy` and
 * `joinRlsPolicy`.
 *
 * ⚠️  SECURITY-CRITICAL — the FK on the right-hand side of `p.id = …` MUST be
 * qualified with the child table's name:
 *
 *     WHERE p.id = <child_table>.<fk>          ← correct
 *     WHERE p.id = <fk>                        ← CROSS-ORG HOLE
 *
 * Postgres resolves an unqualified column name against the INNERMOST scope
 * first — the parent (`p`) inside the sub-select. Whenever the parent happens to
 * own a column with the same name as the child's FK, the predicate silently
 * degrades to `p.id = p.<fk>`, which is **uncorrelated with the child row**.
 * Because the same predicate is also the `WITH CHECK`, that is a cross-org read
 * AND write.
 *
 * This shipped for real: `meta_ad_service` (fk `meta_ad_id`) whose parent
 * `meta_ad` owns a column called `meta_ad_id` — see
 * `drizzle/0050_glossy_arclight.sql:166`. The other 34 child/join policies were
 * correct only by luck, because their parents happened not to own a colliding
 * column name.
 *
 * Qualifying with `getTableName(table)` makes every policy correct **by
 * construction** rather than by luck, and cannot regress when a new column is
 * added to a parent table.
 *
 * `packages/database/src/__tests__/rls-bucketb-policies.test.ts` enumerates
 * EVERY child/join policy declaration in the schema and asserts this shape.
 */
function existsPredicate(
  table: PgTable,
  parent: string,
  fk: string,
  parentOrgCol: string
) {
  const child = getTableName(table);
  return sql`EXISTS (
    SELECT 1
    FROM ${sql.raw(parent)} p
    WHERE p.id = ${sql.raw(child)}.${sql.raw(fk)}
      AND p.${sql.raw(parentOrgCol)} = current_setting('app.current_org_id', true)
  )`;
}

/**
 * Options for `childOrgRlsPolicy`.
 */
export interface ChildOrgRlsPolicyOptions {
  /**
   * The Postgres table name (string, e.g. `'asset'`) of the parent that carries
   * `organization_id`. The EXISTS sub-select queries this table.
   */
  parent: string;
  /**
   * The FK column name on **this** (child) table that references the parent's
   * `id`, e.g. `'asset_id'`. Must be the actual SQL column name (snake_case).
   */
  fk: string;
  /**
   * The column on the **parent** table that holds the org id. Defaults to
   * `'organization_id'`, which is correct for all Bucket-A parents.
   */
  parentOrgCol?: string;
  /**
   * Roles the policy applies to. Defaults to `[appAuthenticated, appPublic]`
   * (same as `orgRlsPolicy`) so booking reads chain through correctly.
   */
  to?: ReturnType<typeof pgRole>[];
}

/**
 * Permissive `FOR ALL` RLS policy for a child table that has no direct
 * `organization_id` column but references a parent that does.
 *
 * USING (and WITH CHECK) predicate:
 *   EXISTS (
 *     SELECT 1 FROM <parent> p
 *     WHERE p.id = <child_table>.<fk>
 *       AND p.<parentOrgCol> = current_setting('app.current_org_id', true)
 *   )
 *
 * This is vanilla Postgres — no Neon-isms. The policy name is always
 * `'child_org_isolation'` so it is distinct from the parent's `'org_isolation'`.
 *
 * Fail-closed: when `app.current_org_id` is unset (NULL), the comparison
 * `p.organization_id = NULL` is NULL → EXISTS returns false → zero rows visible.
 *
 * When the FK is nullable (e.g. voice_call.lead_id), rows whose FK is NULL
 * also return false from EXISTS — they are invisible to app_authenticated.
 * Workers that legitimately need orphaned rows must use withSystemScope
 * (app_system bypasses RLS).
 *
 * Usage:
 * ```ts
 * export const assetAnalysisRlsPolicy = childOrgRlsPolicy(assetAnalysis, {
 *   parent: 'asset',
 *   fk: 'asset_id',
 * });
 * ```
 */
export function childOrgRlsPolicy(
  table: PgTable,
  {
    parent,
    fk,
    parentOrgCol = 'organization_id',
    to = [appAuthenticated, appPublic],
  }: ChildOrgRlsPolicyOptions
) {
  // We use the table reference itself as the "child" alias and <parent> as the
  // parent alias. The EXISTS correlated sub-select is the safest isolation
  // primitive: if the parent row is not visible (e.g. not in this org) the
  // child row is also not visible.
  const predicate = existsPredicate(table, parent, fk, parentOrgCol);

  return pgPolicy('child_org_isolation', {
    as: 'permissive',
    for: 'all',
    to,
    using: predicate,
    withCheck: predicate,
  }).link(table);
}

// =============================================================================
// B2 — Join-table helpers
// =============================================================================

/**
 * Options for `joinRlsPolicy`.
 */
export interface JoinRlsPolicyOptions {
  /**
   * The Postgres table name (string) of the parent to run the EXISTS check
   * against. Choose the parent with the better-indexed FK for org lookups
   * (typically the one whose table has `organization_id` indexed or is smaller).
   */
  parent: string;
  /**
   * The FK column name on this join table that references `parent.id`.
   * Must be the actual SQL column name (snake_case).
   */
  fk: string;
  /**
   * Column on the parent table holding the org id. Defaults to
   * `'organization_id'`.
   */
  parentOrgCol?: string;
  /**
   * Roles the policy applies to. Defaults to `[appAuthenticated, appPublic]`.
   * `practitioner_service` and other booking join tables keep `appPublic` so
   * the public booking flow can read them.
   */
  to?: ReturnType<typeof pgRole>[];
}

/**
 * Permissive `FOR ALL` RLS policy for a join table whose org scope comes
 * entirely from one of its parent tables.
 *
 * Semantically identical to `childOrgRlsPolicy` but named `'join_org_isolation'`
 * to distinguish join tables from strict parent→child hierarchies in the
 * generated migration.
 *
 * Choose the parent whose FK column has the best index for org lookups —
 * documented per table in docs/rls/global-classification.md.
 *
 * Usage:
 * ```ts
 * // practitioner_service → use practitioner_id (practitioner has org index)
 * export const practitionerServiceRlsPolicy = joinRlsPolicy(practitionerService, {
 *   parent: 'practitioner',
 *   fk: 'practitioner_id',
 * });
 * ```
 */
export function joinRlsPolicy(
  table: PgTable,
  {
    parent,
    fk,
    parentOrgCol = 'organization_id',
    to = [appAuthenticated, appPublic],
  }: JoinRlsPolicyOptions
) {
  const predicate = existsPredicate(table, parent, fk, parentOrgCol);

  return pgPolicy('join_org_isolation', {
    as: 'permissive',
    for: 'all',
    to,
    using: predicate,
    withCheck: predicate,
  }).link(table);
}

// =============================================================================
// B3 — Org-self helper
// =============================================================================

/**
 * RLS policy for the `organization` table itself, which is keyed on `id` rather
 * than `organization_id`.
 *
 * USING / WITH CHECK: `id = current_setting('app.current_org_id', true)`
 *
 * This means an authenticated session can see and update only its own
 * organization row — not any other org's row. The policy is scoped to both
 * `app_authenticated` (normal API) and `app_public` (open booking needs to
 * resolve the org config after slug bootstrap).
 *
 * Usage:
 * ```ts
 * export const organizationRlsPolicy = orgSelfRlsPolicy(organization);
 * ```
 */
export function orgSelfRlsPolicy(table: PgTable) {
  const predicate = sql`id = current_setting('app.current_org_id', true)`;

  return pgPolicy('org_self_isolation', {
    as: 'permissive',
    for: 'all',
    to: [appAuthenticated, appPublic],
    using: predicate,
    withCheck: predicate,
  }).link(table);
}

/**
 * Slug-bootstrap SELECT policy for the `organization` table.
 *
 * ⚠️  SECURITY-CRITICAL — W-BOOK senior review. This is the ONLY policy in the
 * entire schema that allows `app_public` to read WITHOUT an org context being
 * set. It is intentionally narrow:
 *
 *   - FOR SELECT only (never INSERT/UPDATE/DELETE).
 *   - TO app_public only (`app_authenticated` always uses `org_self_isolation`).
 *   - Predicate: `is_mock = false AND slug IS NOT NULL`
 *
 * --- Why this predicate? ---
 *
 * W-BOOK reviewed the `organization` table for a tighter "published booking
 * page" gate. There is NO `public_booking_enabled` / `booking_page_published`
 * column in the schema; every org is bookable by slug by design. Slugs are the
 * public booking URL identifier (printed on marketing materials, business cards,
 * etc.) — they are intentionally public information, not a secret.
 *
 * The two conditions that ARE meaningful:
 *
 *   1. `is_mock = false` — excludes demo / brand-preview seed orgs. These orgs
 *      exist only for internal content-preview; they must not appear in public
 *      booking flows. All production orgs set `is_mock = false` (the default).
 *
 *   2. `slug IS NOT NULL` — belt-and-suspenders only. The `slug` column is
 *      defined `NOT NULL` in the schema, so this never filters out a real row;
 *      it documents the intent that an org is only discoverable if it has a
 *      slug, and future schema changes should preserve that invariant.
 *
 * --- Why NOT a "published" column? ---
 *
 * The booking availability gate lives at the service layer, not the org row:
 * `getGeneralBookingConfig` returns `NOT_FOUND` when the org has no active
 * services, which is the correct UX response. Adding a separate
 * `public_booking_enabled` column (future work) would be the right long-term
 * improvement, but it must also be enforced at the application layer — an
 * RLS policy alone cannot send a user-friendly error. That schema change is
 * deferred; we note it here as a known follow-up.
 *
 * --- Exposure risk assessment ---
 *
 * An `app_public` connection (e.g. a stolen pool credential) could in theory
 * enumerate org names/slugs/logos via a full table scan. This is acceptable
 * because: (a) slugs are already on public booking URLs; (b) org names are
 * shown on booking pages; (c) this role has NO INSERT/UPDATE/DELETE here.
 * The `org_self_isolation` policy additionally prevents any write back to org
 * rows even after slug resolution.
 *
 * --- How it interacts with org_self_isolation ---
 *
 * This is a SECOND pgPolicy on `organization`, distinct from `orgSelfRlsPolicy`.
 * Postgres evaluates permissive policies with OR semantics: a row is visible if
 * EITHER policy passes. Correct: slug_bootstrap fires for the pre-context slug
 * lookup; org_self_isolation fires for all post-resolution reads.
 *
 * --- Future: tighten if public_booking_enabled column is added ---
 *
 * If a `public_booking_enabled boolean NOT NULL DEFAULT false` column is added,
 * change the predicate to:
 *   `is_mock = false AND slug IS NOT NULL AND public_booking_enabled = true`
 * and update both this policy AND the application-layer guard to keep them in
 * sync. Until then, the service-layer active-services check is the gate.
 *
 * Usage (organization.ts only, exported once):
 * ```ts
 * export const organizationPublicBookingRlsPolicy =
 *   organizationPublicBookingPolicy(organization);
 * ```
 */
export function organizationPublicBookingPolicy(table: PgTable) {
  // Allow app_public to SELECT non-mock orgs with a slug — no org context
  // needed. This bootstraps the slug → org_id resolution step. After that,
  // withPublicOrgScope sets app.current_org_id and org_self_isolation takes
  // over for all subsequent reads in the same request.
  //
  // is_mock = false: exclude brand-preview demo orgs.
  // slug IS NOT NULL: belt-and-suspenders (NOT NULL by column constraint, but
  //   documents the intent and guards future schema changes).
  //
  // NOT broader than needed: FOR SELECT, TO app_public only. No INSERT/UPDATE/
  // DELETE path exists for app_public on the organization table.
  const predicate = sql`is_mock = false AND slug IS NOT NULL`;

  return pgPolicy('slug_bootstrap', {
    as: 'permissive',
    for: 'select',
    to: [appPublic],
    using: predicate,
    // withCheck is not applicable for SELECT-only policies.
  }).link(table);
}

// =============================================================================
// B4 — Patient-self helper (ENG-647 patient portal)
// =============================================================================

/**
 * Options for `patientSelfRlsPolicy`.
 */
export interface PatientSelfRlsPolicyOptions {
  /**
   * The SQL column name (snake_case) on THIS table that identifies the owning
   * patient's `lead.id`. Defaults to `'lead_id'`. The `lead` table itself
   * passes `'id'`.
   */
  fk?: string;
  /**
   * Extra predicate ANDed onto row ownership, for tables where owning a row
   * does not by itself entitle the patient to read it. See the note in the
   * implementation — this is what keeps clinical notes out of the portal.
   */
  andSql?: SQL;
  /**
   * Restrict the policy to reads only. Defaults to `'select'` — Phase 0
   * patients are read-only at the DB layer; every write (registration, token
   * consumption, session issue/revoke) runs through the system-scoped
   * patient-auth services, mirroring how Better Auth writes its own tables.
   */
  for?: 'select' | 'all';
}

/**
 * AUXILIARY row-ownership policy for patient-portal reads.
 *
 * A signed-in patient (the clinic's customer, NOT clinic staff) may see only
 * rows belonging to their own `lead`. Predicate:
 *
 *   <table>.<fk> = current_setting('app.current_patient_lead_id', true)
 *
 * Fail-closed like every other policy here: outside `withPatientScope` the
 * setting is unset → NULL comparison → zero rows.
 *
 * ⚠️  This is deliberately an AUXILIARY policy (see RLS_AUXILIARY_POLICY_NAMES),
 * NOT an isolating one, for the same reason `slug_bootstrap` is:
 *
 *   - The classification test forbids a second ISOLATING policy per table
 *     ("permissive policies OR together, so a second one can only widen
 *     access"). That concern is about widening WITHIN a role's access.
 *   - This policy is scoped `TO app_patient` ONLY. `app_authenticated` /
 *     `app_public` never match it, so it cannot widen staff or anonymous
 *     access — it only grants the patient role a view it otherwise entirely
 *     lacks (app_patient appears in no org policy's `to` list).
 *
 * The FK is qualified with the table name for the same defense-in-depth reason
 * documented on `existsPredicate` above.
 *
 * Usage:
 * ```ts
 * export const leadPatientSelfPolicy = patientSelfRlsPolicy(lead, { fk: 'id' });
 * ```
 */
export function patientSelfRlsPolicy(
  table: PgTable,
  {
    fk = 'lead_id',
    for: forClause = 'select',
    andSql,
  }: PatientSelfRlsPolicyOptions = {}
) {
  const child = getTableName(table);
  // BOTH the patient AND the clinic.
  //
  // `withPatientScope` already sets `app.current_org_id` alongside the lead
  // id, but no policy read it — so isolation reduced entirely to "the guard
  // resolved the right lead_id". A bug in the session → account → membership
  // lookup that returned the wrong membership row would then yield a
  // complete, RLS-blessed read of another person's record: the database would
  // not object, because it was never told which clinic the request was for.
  //
  // Adding the org predicate costs nothing (the GUC is already set on every
  // patient-scoped transaction) and makes the DB enforce the second half of
  // the invariant the guard checks. Fail-closed either way: an unset GUC
  // compares against NULL and matches no rows.
  const base = sql`${sql.raw(child)}.${sql.raw(fk)} = current_setting('app.current_patient_lead_id', true) AND ${sql.raw(child)}.organization_id = current_setting('app.current_org_id', true)`;

  /**
   * Ownership is NOT always sufficient. On a table that holds more than one
   * kind of row — `form_submission` carries intake, consent AND clinical notes
   * — "belongs to this lead" would hand a patient the assessment written about
   * them. `andSql` narrows the policy to the subset the patient may read, and
   * is ANDed so it can only ever remove rows, never add them.
   */
  const predicate = andSql ? sql`(${base}) AND (${andSql})` : base;

  return pgPolicy('patient_self', {
    as: 'permissive',
    for: forClause,
    to: [appPatient],
    using: predicate,
    // WITH CHECK applies to writes only; harmless for SELECT policies and
    // correct (same-owner) when a table opts into `for: 'all'` later.
    ...(forClause === 'all' ? { withCheck: predicate } : {}),
  }).link(table);
}

// =============================================================================
// Total table classification — every table must be accounted for
// =============================================================================

/**
 * The policy names emitted by the helpers above, and what each one means.
 *
 * A table is ISOLATED if it carries at least one of the isolating policies. The
 * `slug_bootstrap` policy is auxiliary — it is an additional permissive SELECT
 * policy on `organization` and does NOT on its own isolate a table.
 */
export const RLS_POLICY_KINDS = {
  org_isolation: 'Bucket A — direct `organization_id` column (orgRlsPolicy)',
  child_org_isolation:
    'Bucket B — child of an org-owned parent (childOrgRlsPolicy)',
  join_org_isolation: 'Bucket B — join table (joinRlsPolicy)',
  org_self_isolation: 'The `organization` table itself (orgSelfRlsPolicy)',
  user_isolation: 'User-scoped, not org-scoped (hand-written pgPolicy)',
} as const;

export type RlsPolicyKind = keyof typeof RLS_POLICY_KINDS;

/** Policies that exist but do not, on their own, isolate a table. */
export const RLS_AUXILIARY_POLICY_NAMES = new Set([
  'slug_bootstrap',
  // Patient-portal row-ownership reads, TO app_patient only — cannot widen
  // staff/anonymous access (see patientSelfRlsPolicy).
  'patient_self',
]);

/**
 * Tables that are deliberately NOT org-isolated, each with the reason a human
 * reads in review.
 *
 * This is the ONLY escape hatch in the RLS classification. `scripts/rls/
 * check-rls-coverage.mjs` and `__tests__/rls-classification.test.ts` require
 * that EVERY table in the drizzle snapshot resolves to exactly one of:
 *   - an isolating policy (see RLS_POLICY_KINDS), or
 *   - an entry here.
 * A new table with neither fails the build. A table that is both policied and
 * listed here also fails (the classification must be unambiguous).
 *
 * ⚠️  Being listed here means RLS is NOT enabled on the table, and
 * `app_authenticated` holds SELECT/INSERT/UPDATE/DELETE on it (granted
 * schema-wide in `drizzle/0049_rls_roles.sql`). That is acceptable only for
 * tables that hold no org-scoped rows. It is NOT a statement that the table is
 * harmless — see the follow-up noted on the auth tables below.
 */
export const RLS_GLOBAL_EXEMPT: Record<string, string> = {
  // --- Better Auth identity tables (no organization_id; keyed by user) ------
  //
  // FOLLOW-UP (not org isolation, but worth doing): `account`, `two_factor` and
  // `session` hold credential material (password hashes, OAuth refresh tokens,
  // TOTP secrets, session tokens) and `app_authenticated` currently has full
  // DML on them via the schema-wide GRANT. They contain no org-scoped rows, so
  // they are correctly out of scope for org RLS — but a targeted REVOKE for
  // app_authenticated/app_public would be the right least-privilege follow-up.
  user: 'Global identity table. No organization_id — a user may belong to many orgs; org membership is modelled by `member`, which IS org-isolated. Auth reads run through Better Auth on the owner/system connection.',
  session:
    'Better Auth session store, keyed by user_id. Not org data; a session names its active org rather than belonging to one. Session reads are served from Redis, not this table (see auth session cache).',
  account:
    'Better Auth OAuth/credential accounts, keyed by user_id. Not org-scoped.',
  verification:
    'Better Auth email-verification / password-reset tokens, keyed by an opaque identifier. Not org-scoped and never read by an org-scoped query.',
  two_factor: 'Better Auth TOTP secrets, keyed by user_id. Not org-scoped.',
  apikey: 'Better Auth API keys, keyed by user_id. Not org-scoped.',

  meta_pending_connection:
    'A Meta connection authorised BEFORE any workspace was known — that is the point of it. It is written by an org-less public callback and read only by the admin terminal, which is cross-tenant by construction. An organization_id would defeat the feature; `claimed_by_organization_id` records where a row ended up, and is an audit trail rather than a scope.',

  // --- User-scoped preference / device tables -------------------------------
  device_push_token:
    'Push tokens for a user device, keyed by user_id. A user may have devices while active in several orgs; the row belongs to the user, not the org.',
  notification_preference:
    'Per-user notification settings, keyed by user_id. Not org-scoped.',
  user_video_progress:
    'Per-user watch progress against the global `training_video` catalogue. Keyed by user_id, not org.',

  // --- Global, org-independent reference data -------------------------------
  training_video:
    'Global Borradh-authored training catalogue, identical for every org. Readable by all tenants by design; only Borradh staff write it (system role).',
  experiment:
    'Global experiment definitions (PostHog feature keys). Org-independent config; the per-org assignment lives in `experiment_assignment`, which IS org-isolated.',
  stock_clip:
    'Global Borradh-curated stock footage catalogue, identical for every org. Readable by all tenants by design; only Borradh staff seed it (system role, see scripts/seed-stock-footage.ts). The per-org match lives in `service_stock_clip`, which IS org-isolated (child_org_isolation) — same split as experiment/experiment_assignment.',
  technique:
    'Global treatment vocabulary (injection, energy_contact, laser_light…), identical for every org and seeded by Borradh staff (src/scripts/seed-treatment-taxonomy.ts). Readable by all tenants by design — it is the shared language the footage matcher gates on, and a per-org copy would defeat the point. The org-scoped side is `service_agent`, which IS isolated (child_org_isolation) — same split as experiment/experiment_assignment.',
  treatment_agent:
    'Global catalogue of machines and products (Endospheres, EMSculpt, Profhilo…), identical for every org. Same reasoning as `technique`: shared reference data, staff-seeded, and deliberately readable by every tenant so that footage curated once can be matched everywhere. Knowing that "EMSculpt" exists leaks nothing about any organization; which agents a given org USES is held in `service_agent`, which is org-isolated.',

  // --- Patient portal universal identity (Portal v2) ------------------------
  //
  // Unlike the Better Auth tables above, these DO have RLS ENABLED — with zero
  // policies, which is fail-closed for every non-BYPASSRLS role. They are read
  // and written exclusively by the system-scoped patient-auth services
  // (app_system), and deliberately carry NO app_patient grants. They are
  // listed here because they have no organization_id to isolate on: a
  // customer_account spans clinics by design, and a patient_session names the
  // PERSON — the org context is resolved per request.
  customer_account:
    'Universal customer identity (BA `user` model for the patient Better Auth instance; one email = one account, across clinics). No organization_id by design. RLS enabled with ZERO policies — the patient BA instance accesses it on the owner/system (BYPASSRLS) connection only.',
  patient_session:
    'Patient portal session store (BA `session` model), keyed by user_id (the person, not an org membership); carries an organization_id PIN resolved per request. RLS enabled with ZERO policies — accessed only by the patient BA instance on the system connection, like the staff Better Auth `session` table.',
  patient_ba_account:
    'Patient Better Auth `account` model. Empty under the passwordless (emailOTP + magicLink) instance, but required by BA core. Keyed by user_id, not org-scoped. RLS enabled with ZERO policies — BA (system connection) access only.',
  patient_verification:
    'Patient Better Auth `verification` model — emailOTP codes and magic-link tokens, keyed by an opaque identifier. Not org-scoped and never read by an org-scoped query. RLS enabled with ZERO policies — BA (system connection) access only.',

  // --- System-only ledger ---------------------------------------------------
  processed_webhook_event:
    'Webhook idempotency ledger, keyed by (provider, event_id). Written only by the webhook router on the app_system (BYPASSRLS) connection before any org is resolved; it has no organization_id to isolate on.',
};

/** One table's RLS classification, derived from the schema module. */
export interface RlsTableClassification {
  table: string;
  /** Isolating policies found on the table (usually exactly one). */
  policies: RlsPolicyKind[];
  /** Auxiliary (non-isolating) policies, e.g. `slug_bootstrap`. */
  auxiliaryPolicies: string[];
  /** Reason string if the table is listed in RLS_GLOBAL_EXEMPT. */
  exemptReason?: string;
}

/**
 * Derive the RLS classification of every table from the schema module itself.
 *
 * The input is the artifact being checked (`import * as schema from
 * './schema/index.js'`), NOT a hand-written list — a new table or a new policy
 * shows up here automatically, which is the entire point.
 *
 * Pass the module in rather than importing it, so this file stays free of a
 * circular import (schema files import the policy helpers from here).
 */
export function classifyRlsTables(
  schemaModule: Record<string, unknown>
): Map<string, RlsTableClassification> {
  const byTable = new Map<string, RlsTableClassification>();

  const ensure = (table: string): RlsTableClassification => {
    let entry = byTable.get(table);
    if (!entry) {
      entry = { table, policies: [], auxiliaryPolicies: [] };
      byTable.set(table, entry);
    }
    return entry;
  };

  for (const value of Object.values(schemaModule)) {
    if (is(value, Table)) {
      ensure(getTableName(value));
      continue;
    }
    if (!is(value, PgPolicy)) continue;

    // `_linkedTable` is set by `.link(table)` but is not on drizzle's public
    // PgPolicy type, so it needs a cast.
    const linked = (value as PgPolicy & { _linkedTable?: PgTable })
      ._linkedTable;
    if (!linked) continue; // unlinked policy — not attached to any table
    const entry = ensure(getTableName(linked));

    if (value.name in RLS_POLICY_KINDS) {
      entry.policies.push(value.name as RlsPolicyKind);
    } else {
      entry.auxiliaryPolicies.push(value.name);
    }
  }

  for (const [table, reason] of Object.entries(RLS_GLOBAL_EXEMPT)) {
    ensure(table).exemptReason = reason;
  }

  return byTable;
}
