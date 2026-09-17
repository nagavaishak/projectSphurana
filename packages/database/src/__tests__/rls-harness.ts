/**
 * RLS Isolation Test Harness — W-CI deliverable (c)
 *
 * Reusable test utilities for Phase 3 (T1/T2) isolation and fail-closed tests.
 * These run against a REAL Postgres instance (local or CI postgres:16) with
 * RLS_ENABLED=true and the three roles provisioned by 0049_rls_roles.sql.
 *
 * The harness is NOT a vitest test file — it exports helpers that T1/T2 spec
 * files import. See the `describe.skip` block at the bottom for the scaffolded
 * spec structure.
 *
 * ## Setup requirements (Phase 2 must complete first)
 *
 * Before these tests can run:
 * 1. 0049_rls_roles.sql has been applied (roles exist).
 * 2. The policy migration (Phase 2 / I1) has been applied (ENABLE ROW LEVEL
 *    SECURITY + CREATE POLICY on all 56 Bucket A tables).
 * 3. Role passwords have been provisioned (Phase 2 / I2).
 * 4. Environment variables set:
 *    - DATABASE_URL_AUTHENTICATED  — postgres://app_authenticated:<pw>@.../db
 *    - DATABASE_URL_PUBLIC          — postgres://app_public:<pw>@.../db
 *    - DATABASE_URL_SYSTEM          — postgres://app_system:<pw>@.../db
 *    - DATABASE_URL                 — owner URL (for test data setup/teardown)
 *    - RLS_ENABLED=true
 *
 * ## Architecture
 *
 * Each test:
 *   1. Creates two organisations (A, B) via the owner connection (bypasses RLS
 *      — the owner is not subject to RLS policies).
 *   2. Seeds representative rows for each org.
 *   3. Connects as `app_authenticated`, opens a transaction with
 *      `SET LOCAL app.current_org_id = <orgA>`, runs queries, asserts only
 *      orgA rows are visible.
 *   4. Tries to read/write orgB data while scoped to orgA — asserts zero rows
 *      returned and forged-org writes are blocked.
 *   5. Tears down (deletes the test orgs + their cascade-deleted rows).
 *
 * The `withOrgScope` / `withPublicOrgScope` / `withSystemScope` helpers from
 * `rls-context.ts` are tested for correct behaviour when RLS is on. Raw
 * `SET LOCAL` SQL is also used for some assertions to test the policy layer
 * independently of the helper layer.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from '../client.js';
import * as schema from '../schema/index.js';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

/** Read a required env var; throw a clear error if absent. */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `RLS harness: ${name} is not set. Run Phase 2 (I2/I3) first to provision role passwords and wiring.`
    );
  }
  return v;
}

// ---------------------------------------------------------------------------
// Connection factories
// ---------------------------------------------------------------------------

/** Options for creating a harness connection. */
interface ConnectionOptions {
  /** Maximum pool size (default 1 — tests are sequential). */
  max?: number;
}

/**
 * Create a drizzle database client for the given connection URL.
 * Returns both the drizzle instance and the underlying postgres.js client
 * (needed for `end()` cleanup).
 */
export function makeConnection(url: string, opts: ConnectionOptions = {}) {
  const client = postgres(url, { max: opts.max ?? 1 });
  const db = drizzle(client, { schema }) as Database;
  return { db, client };
}

/**
 * Open a connection as `app_authenticated` (NOBYPASSRLS, subject to RLS).
 * Use this for T1/T2 isolation assertions.
 */
export function authConnection(opts: ConnectionOptions = {}) {
  return makeConnection(requireEnv('DATABASE_URL_AUTHENTICATED'), opts);
}

/**
 * Open a connection as `app_public` (NOBYPASSRLS, least-privilege booking role).
 * Use this for T3 open-booking isolation assertions.
 */
export function publicConnection(opts: ConnectionOptions = {}) {
  return makeConnection(requireEnv('DATABASE_URL_PUBLIC'), opts);
}

/**
 * Open a connection as `app_patient` (NOBYPASSRLS, SELECT-only) — the role
 * behind the signed-in CUSTOMER in the patient portal.
 *
 * This is the only role scoped PER ROW rather than per org: the `patient_self`
 * policies key on `app.current_patient_lead_id`, so another customer's rows
 * are invisible regardless of the WHERE clause. Pair with
 * `withRawPatientScope`.
 */
export function patientConnection(opts: ConnectionOptions = {}) {
  return makeConnection(requireEnv('DATABASE_URL_PATIENT'), opts);
}

/**
 * Open a connection as `app_system` (BYPASSRLS — cross-org by design).
 * Use this to set up and tear down test data without policy interference.
 */
export function systemConnection(opts: ConnectionOptions = {}) {
  return makeConnection(requireEnv('DATABASE_URL_SYSTEM'), opts);
}

/**
 * Open a connection as the owner (bypasses RLS, DDL-capable).
 * Use this for test setup/teardown when `app_system` is not yet provisioned.
 */
export function ownerConnection(opts: ConnectionOptions = {}) {
  return makeConnection(requireEnv('DATABASE_URL'), opts);
}

// ---------------------------------------------------------------------------
// Org context helpers
// ---------------------------------------------------------------------------

/**
 * Run `fn` in a transaction with `app.current_org_id` set to `orgId`.
 * This mirrors what `withOrgScope` does at runtime (test it directly so
 * the harness works even before Phase 2 I4 wiring is complete).
 *
 * @param db     A drizzle database instance (any role, but usually app_authenticated).
 * @param orgId  The org to scope to.
 * @param fn     The operation to run inside the scoped transaction.
 */
export async function withRawOrgScope<T>(
  db: Database,
  orgId: string,
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await (tx as Database).execute(
      // Use set_config with is_local=true (== SET LOCAL) so the value is
      // automatically cleared at transaction end — no explicit cleanup needed.
      // This is the exact same mechanism as withOrgScope in rls-context.ts.
      `SELECT set_config('app.current_org_id', '${orgId}', true)` as never
    );
    return fn(tx as Database);
  });
}

/**
 * Run `fn` in a transaction scoped to ONE PATIENT, mirroring `withPatientScope`
 * in rls-context.ts: it sets `app.current_patient_lead_id` (read by the
 * `patient_self` policies) and `app.current_org_id` (so any org predicate the
 * policies later grow also resolves).
 *
 * Both are SET LOCAL, so they clear at transaction end and cannot leak across
 * a pooled connection.
 *
 * @param db     A drizzle instance from `patientConnection()`.
 * @param leadId The signed-in customer's own lead id.
 * @param orgId  The clinic the session is pinned to.
 */
export async function withRawPatientScope<T>(
  db: Database,
  leadId: string,
  orgId: string,
  fn: (tx: Database) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await (tx as Database).execute(
      `SELECT set_config('app.current_patient_lead_id', '${leadId}', true)` as never
    );
    await (tx as Database).execute(
      `SELECT set_config('app.current_org_id', '${orgId}', true)` as never
    );
    return fn(tx as Database);
  });
}

/**
 * Run `fn` with NO patient context set — the fail-closed case for the portal.
 *
 * `current_setting('app.current_patient_lead_id', true)` returns NULL, and
 * `lead_id = NULL` is never true, so every patient-readable table must return
 * ZERO rows rather than all of them. Deliberately opens no transaction: the
 * omission of SET LOCAL is the point.
 */
export async function withNoPatientScope<T>(
  db: Database,
  fn: (conn: Database) => Promise<T>
): Promise<T> {
  return fn(db);
}

/**
 * Run `fn` with NO org context set (simulates a forgotten `withOrgScope`
 * — the fail-closed case).
 *
 * With RLS on, any query against a Bucket A table run without this setting
 * will see `current_setting('app.current_org_id', true) = NULL`, and the
 * policy predicate `organization_id = NULL` is never true → zero rows.
 *
 * This does NOT open a transaction — the omission of SET LOCAL is the point.
 */
export async function withNoOrgScope<T>(
  db: Database,
  fn: (conn: Database) => Promise<T>
): Promise<T> {
  return fn(db);
}

// ---------------------------------------------------------------------------
// Test-data lifecycle
// ---------------------------------------------------------------------------

export interface TestOrg {
  id: string;
  name: string;
}

export interface TwoOrgFixture {
  orgA: TestOrg;
  orgB: TestOrg;
  /** Clean up both orgs and all their cascade-deleted rows. */
  cleanup: () => Promise<void>;
}

/**
 * Create two test organisations. Uses the owner/system connection so this
 * works even before per-org context is wired.
 *
 * Schema note: the `organization` table has a `slug` column (unique).
 * We generate unique slugs per test run to avoid conflicts in CI.
 */
export async function createTwoOrgs(
  ownerDb: Database,
  prefix = 'rls-test'
): Promise<TwoOrgFixture> {
  const ts = Date.now();
  const orgAId = `${prefix}-a-${ts}`;
  const orgBId = `${prefix}-b-${ts}`;

  // Insert minimally-valid org rows. Required NOT-NULL-without-default columns
  // on `organization`: id, name, slug, business_type (enum). is_mock defaults
  // to false (so the slug_bootstrap policy applies). Timestamps have defaults.
  await ownerDb.execute(
    `
    INSERT INTO organization (id, name, slug, business_type)
    VALUES
      ('${orgAId}', 'RLS Test Org A (${ts})', '${orgAId}', 'salon'),
      ('${orgBId}', 'RLS Test Org B (${ts})', '${orgBId}', 'salon')
  ` as never
  );

  const orgA: TestOrg = { id: orgAId, name: `RLS Test Org A (${ts})` };
  const orgB: TestOrg = { id: orgBId, name: `RLS Test Org B (${ts})` };

  const cleanup = async () => {
    // ON DELETE CASCADE handles child rows; we only need to delete the orgs.
    await ownerDb.execute(
      `
      DELETE FROM organization WHERE id IN ('${orgAId}', '${orgBId}')
    ` as never
    );
  };

  return { orgA, orgB, cleanup };
}

/**
 * Seed a minimal lead row for `orgId`. Returns the lead id so assertions
 * can verify specific rows are/aren't visible.
 */
export async function seedLead(
  ownerDb: Database,
  orgId: string,
  overrides: { firstName?: string } = {}
): Promise<string> {
  // Required NOT-NULL-without-default columns on `lead`: id, organization_id,
  // first_name. status/source/consent_*/timestamps all carry defaults.
  const id = `rls-lead-${orgId}-${Date.now()}-${Math.floor(performance.now())}`;
  await ownerDb.execute(
    `
    INSERT INTO lead (id, organization_id, first_name)
    VALUES ('${id}', '${orgId}', '${overrides.firstName ?? 'RLS Test'}')
  ` as never
  );
  return id;
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert that querying a table scoped to `viewerOrgId` does NOT return
 * `targetRowId`. Used to verify cross-org isolation: viewer is scoped to their
 * own org, target row belongs to a different org.
 */
export async function assertRowNotVisible(
  authDb: Database,
  viewerOrgId: string,
  tableName: string,
  targetRowId: string
): Promise<void> {
  const rows = await withRawOrgScope(authDb, viewerOrgId, (tx) =>
    (tx as Database).execute(
      `SELECT id FROM ${tableName} WHERE id = '${targetRowId}'` as never
    )
  );
  const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
  if (ids.includes(targetRowId)) {
    throw new Error(
      `ISOLATION FAILURE: row ${targetRowId} in ${tableName} is visible when scoped to org ${viewerOrgId} (it belongs to a different org). RLS is not preventing cross-org reads.`
    );
  }
}

/**
 * Assert that a write with a forged `organization_id` is blocked by the
 * WITH CHECK predicate. The INSERT should either be rejected (throws) or —
 * if silently swallowed — the row must not appear in either org's scope.
 *
 * @param authDb        Connection as app_authenticated.
 * @param ownOrgId      The org the connection is scoped to.
 * @param targetOrgId   The org ID we're trying to forge into.
 * @param tableName     The table to attempt the INSERT on.
 * @param rowId         The ID to use for the test row.
 * @param requiredCols  Map of any additional NOT-NULL columns → raw SQL value
 *                      literal (e.g. `{ first_name: "'X'", status: "'new'" }`).
 */
export async function assertForgedWriteBlocked(
  authDb: Database,
  ownOrgId: string,
  targetOrgId: string,
  tableName: string,
  rowId: string,
  requiredCols: Record<string, string> = {}
): Promise<void> {
  const extraNames = Object.keys(requiredCols);
  const colList = ['id', 'organization_id', ...extraNames].join(', ');
  const valList = [
    `'${rowId}'`,
    `'${targetOrgId}'`,
    ...extraNames.map((c) => requiredCols[c]),
  ].join(', ');

  let threw = false;
  try {
    await withRawOrgScope(authDb, ownOrgId, (tx) =>
      (tx as Database).execute(
        `INSERT INTO ${tableName} (${colList}) VALUES (${valList})` as never
      )
    );
  } catch {
    threw = true;
  }

  if (!threw) {
    // If no throw, verify the row didn't land in the target org.
    const rows = await withRawOrgScope(authDb, targetOrgId, (tx) =>
      (tx as Database).execute(
        `SELECT id FROM ${tableName} WHERE id = '${rowId}'` as never
      )
    );
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    if (ids.includes(rowId)) {
      throw new Error(
        `ISOLATION FAILURE: forged INSERT into ${tableName} with ` +
          `organization_id='${targetOrgId}' succeeded — WITH CHECK did not block it.`
      );
    }
  }
  // Either threw (policy rejected) or landed nowhere visible — both are correct.
}

/**
 * Assert that a query WITHOUT org context returns zero rows (fail-closed check).
 * This is the canonical T2 assertion.
 */
export async function assertFailClosed(
  authDb: Database,
  tableName: string
): Promise<void> {
  const rows = await withNoOrgScope(authDb, (conn) =>
    conn.execute(`SELECT id FROM ${tableName} LIMIT 1` as never)
  );
  const count = (rows as unknown[]).length;
  if (count > 0) {
    throw new Error(
      `FAIL-CLOSED FAILURE: query on ${tableName} without org context returned ${count} row(s). With RLS on, zero rows should be returned (policy predicate is NULL = NULL → false → no rows).`
    );
  }
}

// ---------------------------------------------------------------------------
// Phase 3 T1/T2 spec scaffolding lives in `rls-harness.scaffolding.test.ts`
// (a `.test.ts` so it stays out of the library build). It imports the helpers
// above and contains the `describe.skip` templates to copy into the real
// rls-isolation.test.ts / rls-fail-closed.test.ts once Phase 2 is complete.
// ---------------------------------------------------------------------------
