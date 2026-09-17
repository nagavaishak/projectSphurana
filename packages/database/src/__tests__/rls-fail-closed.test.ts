/**
 * Phase 3 / T2 — RLS fail-closed + least-privilege grants.
 *
 * Runs ONLY against a real RLS-enabled DB (see rls-isolation.test.ts header for
 * the env vars). Skipped otherwise so normal CI stays green.
 *
 * Proves:
 *  - a query run WITHOUT org context returns ZERO rows (fail-closed, not a leak)
 *  - `app_public` is denied (by GRANT, before RLS) on a non-booking table
 *  - `app_public` CAN read a granted booking table under org scope
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import {
  type TwoOrgFixture,
  assertFailClosed,
  authConnection,
  createTwoOrgs,
  ownerConnection,
  publicConnection,
  seedLead,
  withNoOrgScope,
  withRawOrgScope,
} from './rls-harness.js';

const RLS_E2E =
  process.env.RLS_ENABLED === 'true' &&
  !!process.env.DATABASE_URL_AUTHENTICATED;

describe.skipIf(!RLS_E2E)(
  'T2 — RLS fail-closed + grants (RLS_ENABLED=true)',
  () => {
    let ownerConn: ReturnType<typeof ownerConnection>;
    let authConn: ReturnType<typeof authConnection>;
    let publicConn: ReturnType<typeof publicConnection>;
    let fixture: TwoOrgFixture;

    beforeAll(async () => {
      ownerConn = ownerConnection();
      authConn = authConnection();
      publicConn = publicConnection();
      fixture = await createTwoOrgs(ownerConn.db, 'rls-t2');
      await seedLead(ownerConn.db, fixture.orgA.id);
      await seedLead(ownerConn.db, fixture.orgB.id);
    });

    afterAll(async () => {
      await fixture.cleanup();
      await ownerConn.client.end();
      await authConn.client.end();
      await publicConn.client.end();
    });

    it('lead: query without org context returns zero rows', async () => {
      await assertFailClosed(authConn.db, 'lead');
    });

    it('appointment: query without org context returns zero rows', async () => {
      await assertFailClosed(authConn.db, 'appointment');
    });

    it('app_public is DENIED on a non-booking table (payment) by GRANT', async () => {
      let denied = false;
      try {
        await withNoOrgScope(publicConn.db, (conn) =>
          (conn as Database).execute('SELECT id FROM payment LIMIT 1' as never)
        );
      } catch (err) {
        // drizzle wraps the error ("Failed query: …"); the real PostgresError —
        // permission denied / SQLSTATE 42501 — is on err.cause.
        const e = err as {
          message?: string;
          cause?: { message?: string; code?: string };
        };
        const text = `${e.message ?? ''} ${e.cause?.message ?? ''}`;
        denied = /permission denied/i.test(text) || e.cause?.code === '42501';
      }
      expect(denied).toBe(true);
    });

    it('app_public CAN read a granted booking table (lead) under org scope', async () => {
      const leadAId = await seedLead(ownerConn.db, fixture.orgA.id, {
        firstName: 'Public-readable',
      });
      const rows = await withRawOrgScope(publicConn.db, fixture.orgA.id, (tx) =>
        (tx as Database).execute(
          `SELECT id FROM lead WHERE id = '${leadAId}'` as never
        )
      );
      const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
      expect(ids).toContain(leadAId);
    });
  }
);
