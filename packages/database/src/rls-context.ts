import { AsyncLocalStorage } from 'node:async_hooks';
import { databaseEnv } from '@borradh-workspace/env/database';
import { sql } from 'drizzle-orm';
import {
  type Database,
  dbAuthenticated,
  dbPatient,
  dbPublic,
  dbSystem,
} from './client.js';

/**
 * RLS Context — organization and user context for Row-Level Security.
 *
 * This module is the runtime half of the RLS design (see
 * docs/rls/rls-implementation-plan.md). It is INERT until `RLS_ENABLED=true`:
 * while the flag is off, every scope helper passes straight through to `db`
 * with NO transaction, so behavior is identical to pre-RLS code. This is what
 * makes the per-table rollout (and instant flag-flip rollback) safe, and it is
 * what avoids the txn-per-request pool-saturation regression.
 */
export interface RlsContext {
  /** The organization ID to scope queries to */
  organizationId: string;
  /** Optional user ID for audit/tracking purposes */
  userId?: string;
}

/**
 * PostgreSQL session variable names used by RLS policies.
 * Set via set_config() and read via current_setting() in policies, e.g.
 * `organization_id = current_setting('app.current_org_id', true)`.
 */
const RLS_ORG_ID_VAR = 'app.current_org_id';
const RLS_USER_ID_VAR = 'app.current_user_id';
/** Patient portal (ENG-647): the signed-in patient's lead.id — read by the
 * `patient_self` policies (see rls-policy.ts patientSelfRlsPolicy). */
const RLS_PATIENT_LEAD_ID_VAR = 'app.current_patient_lead_id';

/**
 * Per-request carrier for the RLS context. The auth guard runs the request
 * handler inside `runWithRlsContext({ organizationId, userId }, …)` (wired in
 * Phase 2 / I4); `withOrgScope` then reads it here. Using AsyncLocalStorage
 * keeps the context off the DB hot-path — no DB cost to carry it — and mirrors
 * the observability context pattern (packages/observability/src/context.ts).
 */
/**
 * The ambient scope marker. Either a concrete org context (set by the request
 * path via `runWithRlsContext`) or the SYSTEM sentinel (set by `withSystemScope`
 * for worker/webhook/cron/testing paths). The system sentinel lets a nested
 * `withOrgScope` — reached when a system path calls a shared feature service
 * that happens to use `withOrgScope` — run as the BYPASSRLS system role instead
 * of fail-fasting, which is exactly the cross-org behavior those paths intend.
 */
const SYSTEM_SCOPE = Object.freeze({ system: true as const });
type AmbientScope = RlsContext | typeof SYSTEM_SCOPE;

function isSystemScope(
  scope: AmbientScope | undefined
): scope is typeof SYSTEM_SCOPE {
  return scope !== undefined && 'system' in scope;
}

const rlsStore = new AsyncLocalStorage<AmbientScope>();

/** True only when RLS is switched on for this process. */
function rlsEnabled(): boolean {
  return databaseEnv.RLS_ENABLED;
}

/**
 * Run `fn` with the given RLS context bound to AsyncLocalStorage so that any
 * `withOrgScope` call inside it can discover the active org. Cheap (no DB).
 */
export function runWithRlsContext<T>(context: RlsContext, fn: () => T): T {
  return rlsStore.run(context, fn);
}

/**
 * Run `fn` under the ambient SYSTEM scope, so any nested `withOrgScope` bypasses
 * (cross-org) on the `app_system` pool rather than fail-fasting for a missing
 * org. Used by `withSystemScope` to model worker/webhook/cron execution.
 */
function runWithSystemContext<T>(fn: () => T): T {
  return rlsStore.run(SYSTEM_SCOPE, fn);
}

/** Read the current request's RLS context, if any. (SYSTEM scope reads as none.) */
export function getRlsContext(): RlsContext | undefined {
  const scope = rlsStore.getStore();
  return isSystemScope(scope) ? undefined : scope;
}

/**
 * Apply the org/user context to an open transaction via SET LOCAL
 * (transaction-scoped, auto-cleared at commit/rollback, propagates through
 * PgBouncer transaction-mode pooling).
 */
async function applyOrgScope(tx: Database, context: RlsContext): Promise<void> {
  // set_config(setting, value, is_local=true) === SET LOCAL.
  await tx.execute(
    sql`SELECT set_config(${RLS_ORG_ID_VAR}, ${context.organizationId}, true)`
  );
  if (context.userId) {
    await tx.execute(
      sql`SELECT set_config(${RLS_USER_ID_VAR}, ${context.userId}, true)`
    );
  }
}

interface ScopeOptions {
  /**
   * Connection/pool to run against. When omitted, each helper defaults to its
   * role-specific pool (wired in Phase 2 / I3): withOrgScope → app_authenticated,
   * withPublicOrgScope → app_public, withSystemScope → app_system. Those pools
   * fall back to the default `db` until an environment provisions the role URLs,
   * so behavior is unchanged before wiring. Tests pass a mock db here.
   */
  db?: Database;
}

/**
 * Run an org-scoped operation under the active request's RLS context.
 *
 * - Flag OFF: passes straight through — `operation(db)`, NO transaction, NO
 *   context required. Fully inert.
 * - Flag ON: requires an org in AsyncLocalStorage (fail-fast — a forgotten
 *   `runWithRlsContext` is a bug, not a silent cross-org read), opens a SHORT
 *   operation-scoped transaction, sets `app.current_org_id`, runs the work,
 *   commits. RLS policies then filter every statement to that org.
 *
 * @example
 * const rows = await withOrgScope((tx) => tx.query.lead.findMany());
 */
export async function withOrgScope<T>(
  operation: (tx: Database) => Promise<T>,
  options?: ScopeOptions
): Promise<T> {
  if (!rlsEnabled()) {
    // Flag OFF: passthrough. Honor an injected db (tests inject a mock; atomic
    // callers thread their own connection). No transaction, no context needed.
    return operation(options?.db ?? dbAuthenticated);
  }

  const ambient = rlsStore.getStore();

  // Ambient SYSTEM scope: a worker/webhook/cron/testing path (withSystemScope)
  // is running a shared feature service that happens to use withOrgScope. Those
  // paths are cross-org by design and connect as the BYPASSRLS `app_system`
  // role, so run on that pool — no org context, no SET LOCAL, no transaction
  // (mirrors withSystemScope). This is what lets the same service body serve
  // both the org-scoped request path and the system path.
  if (isSystemScope(ambient)) {
    return operation(dbSystem);
  }

  const context = ambient;
  if (!context?.organizationId) {
    throw new Error(
      'withOrgScope called without an RLS organization context. ' +
        'The request must run inside runWithRlsContext({ organizationId, … }) ' +
        'or withSystemScope (for worker/webhook/cron paths). ' +
        'This is fail-fast: with RLS on, an unscoped query would otherwise see ' +
        'no org and return zero rows.'
    );
  }

  // Flag ON (enforcement): MUST run on the `app_authenticated` pool — a
  // non-bypass role. A `db` threaded in from a controller/service is the owner
  // pool, which would BYPASS RLS entirely, so it is deliberately IGNORED here;
  // connecting as the role is what makes the policies bite.
  return dbAuthenticated.transaction(async (tx) => {
    await applyOrgScope(tx as Database, context);
    return operation(tx as Database);
  });
}

/**
 * Run a booking operation for an EXPLICIT org (the open, unauthenticated
 * booking flow has no user session, so the org comes from the resolved public
 * slug — not AsyncLocalStorage). Connects via the least-privilege `app_public`
 * pool (wired in Phase 2 / I3; defaults to `db` until then).
 *
 * Flag OFF: passthrough, no transaction. Flag ON: short txn + SET LOCAL.
 *
 * @see docs/rls/rls-implementation-plan.md §1 (the critical booking concern)
 */
export async function withPublicOrgScope<T>(
  organizationId: string,
  operation: (tx: Database) => Promise<T>,
  options?: ScopeOptions
): Promise<T> {
  if (!rlsEnabled()) {
    return operation(options?.db ?? dbPublic);
  }

  if (!organizationId) {
    throw new Error(
      'withPublicOrgScope called without an organizationId. The org must be ' +
        'resolved from the public booking slug before any scoped query runs.'
    );
  }

  // Flag ON: MUST run on the least-privilege `app_public` pool (ignore any owner
  // db threaded in — see withOrgScope). This is what limits a compromised public
  // booking endpoint to the booking tables only.
  return dbPublic.transaction(async (tx) => {
    await applyOrgScope(tx as Database, { organizationId });
    return operation(tx as Database);
  });
}

/**
 * Patient-portal scope (ENG-647): run an operation as the signed-in PATIENT
 * (the clinic's customer). Explicit context like `withPublicOrgScope` — the
 * patient session is validated by the PatientAuthGuard, which resolves the
 * lead/org ids and passes them here; there is no Better Auth session and no
 * AsyncLocalStorage carrier for patients.
 *
 * Flag OFF: passthrough on the patient pool (falls back to owner — inert).
 * Flag ON: short txn on the least-privilege `app_patient` pool, SET LOCAL
 * `app.current_patient_lead_id` (read by the `patient_self` policies) AND
 * `app.current_org_id` (so any org-predicated policy that later adds
 * app_patient to its `to` list scopes correctly, and so `organization`-config
 * reads resolve). app_patient holds SELECT only — every patient-initiated
 * write goes through the system-scoped patient-auth services.
 */
export interface PatientScopeContext {
  /** The signed-in patient's lead.id (from the validated patient session). */
  leadId: string;
  /** The patient's organization (denormalized on patient_auth). */
  organizationId: string;
}

export async function withPatientScope<T>(
  context: PatientScopeContext,
  operation: (tx: Database) => Promise<T>,
  options?: ScopeOptions
): Promise<T> {
  if (!rlsEnabled()) {
    return operation(options?.db ?? dbPatient);
  }

  // FAIL CLOSED. With RLS on, patient reads MUST run on the least-privilege
  // `app_patient` pool. If `DATABASE_URL_PATIENT` is unset, `dbPatient`
  // silently resolves to the OWNER pool — and because the patient tables use
  // ENABLE (not FORCE) row-level security, the owner bypasses every
  // `patient_self` policy, turning this scope into a cross-tenant read with no
  // DB-enforced isolation at all. Refuse to run rather than leak: a misconfig
  // becomes a visible outage (provision the role, set the URL) instead of a
  // silent HIPAA-adjacent data breach. (ENG-647 review: RLS fail-open.)
  if (!databaseEnv.DATABASE_URL_PATIENT) {
    throw new Error(
      'withPatientScope requires DATABASE_URL_PATIENT when RLS_ENABLED=true, ' +
        'but it is unset — refusing to run patient queries on the owner pool, ' +
        'which would bypass the patient_self RLS policies. Provision the ' +
        'app_patient role (scripts/rls/provision-role-passwords.mjs) and set ' +
        'DATABASE_URL_PATIENT.'
    );
  }

  if (!context.leadId || !context.organizationId) {
    throw new Error(
      'withPatientScope called without a leadId/organizationId. The patient ' +
        'session must be validated (PatientAuthGuard) before any scoped query.'
    );
  }

  // Flag ON: MUST run on the least-privilege `app_patient` pool (ignore any
  // owner db threaded in — see withOrgScope for the reasoning).
  return dbPatient.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config(${RLS_PATIENT_LEAD_ID_VAR}, ${context.leadId}, true)`
    );
    await tx.execute(
      sql`SELECT set_config(${RLS_ORG_ID_VAR}, ${context.organizationId}, true)`
    );
    return operation(tx as Database);
  });
}

/**
 * Run a SYSTEM operation that is cross-org by design (worker, webhook-router,
 * webhooks, cron, seeders). Connects via the `app_system` pool, whose role has
 * BYPASSRLS, so no org context and no SET LOCAL are needed — the operation sees
 * all rows. (Wired to the system pool in Phase 2 / I3; defaults to `db`, which
 * connects as the owner and therefore also bypasses RLS, until then.)
 *
 * SECURITY: this is the ONLY sanctioned bypass. It must never be reachable from
 * the public API request path — the public API connects as `app_authenticated`
 * (NOBYPASSRLS) and cannot bypass at all.
 */
export async function withSystemScope<T>(
  operation: (conn: Database) => Promise<T>,
  options?: ScopeOptions
): Promise<T> {
  // Flag OFF: passthrough, honoring an injected db (tests).
  if (!rlsEnabled()) {
    return operation(options?.db ?? dbSystem);
  }

  // Flag ON: run on the `app_system` pool (BYPASSRLS); ignore any owner db
  // threaded in. No transaction or SET LOCAL: the BYPASSRLS role is what grants
  // cross-org visibility. Wrapping in a txn here would only risk re-introducing
  // the long-lived-transaction pool wedge for no benefit.
  //
  // Bind the SYSTEM scope for the duration so any nested withOrgScope (reached
  // when this operation calls a shared feature service — handleIncomingMessage,
  // generateMonthlyBatch, createConversation, …) also runs as app_system rather
  // than fail-fasting for a missing org context.
  return runWithSystemContext(() => operation(dbSystem));
}

// ===========================================================================
// Legacy explicit-context helpers (pre-AsyncLocalStorage).
// Retained for backward compatibility (the global RlsInterceptor still imports
// withRlsContext). New code should use withOrgScope / withPublicOrgScope /
// withSystemScope above.
// ===========================================================================

/**
 * Sets RLS context variables within a transaction (explicit form).
 * @deprecated Prefer withOrgScope, which reads context from AsyncLocalStorage.
 */
export async function setRlsContext(
  tx: Database,
  context: RlsContext
): Promise<void> {
  await applyOrgScope(tx, context);
}

/**
 * Clears RLS context variables within a transaction. Rarely needed — SET LOCAL
 * vars auto-clear at transaction end.
 */
export async function clearRlsContext(tx: Database): Promise<void> {
  await tx.execute(sql`SELECT set_config(${RLS_ORG_ID_VAR}, '', true)`);
  await tx.execute(sql`SELECT set_config(${RLS_USER_ID_VAR}, '', true)`);
}

/**
 * Executes an operation within an RLS-enabled transaction using an explicitly
 * passed context.
 * @deprecated Prefer withOrgScope (AsyncLocalStorage-based).
 */
export async function withRlsContext<T>(
  db: Database,
  context: RlsContext,
  operation: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await setRlsContext(tx as Database, context);
    return operation(tx as Database);
  });
}

/**
 * @deprecated Use withSystemScope (app_system pool). This alias preserves the
 * old call shape. The previous implementation used `SET LOCAL ROLE rls_bypass`,
 * which is removed — bypass is now by process/role, not per-statement role
 * switching.
 */
export async function withBypassContext<T>(
  db: Database,
  operation: (tx: Database) => Promise<T>
): Promise<T> {
  return withSystemScope(operation, { db });
}

/**
 * Type guard: does this partial context carry a usable org id?
 */
export function hasRlsContext(
  context: Partial<RlsContext>
): context is RlsContext {
  return (
    typeof context.organizationId === 'string' &&
    context.organizationId.length > 0
  );
}
