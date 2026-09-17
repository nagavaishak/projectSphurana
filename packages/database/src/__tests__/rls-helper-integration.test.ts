/**
 * Phase 3 / T4-lite — production code path isolation.
 *
 * T1/T2 prove the policies with raw SQL. This proves the REAL runtime path the
 * app uses: the request interceptor's `runWithRlsContext({ organizationId })`
 * (AsyncLocalStorage) → `withOrgScope` (opens a short txn on the
 * `app_authenticated` pool, sets app.current_org_id) → a drizzle ORM query.
 * A "SELECT all leads" through the ORM must still come back filtered to the
 * scoped org — that is the whole point of defense-in-depth RLS.
 *
 * Runs only with RLS_ENABLED=true + the role URLs (see rls-isolation.test.ts).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWithRlsContext, withOrgScope } from '../rls-context.js';
import { lead } from '../schema/index.js';
import {
  type TwoOrgFixture,
  createTwoOrgs,
  ownerConnection,
  seedLead,
} from './rls-harness.js';

const RLS_E2E =
  process.env.RLS_ENABLED === 'true' &&
  !!process.env.DATABASE_URL_AUTHENTICATED;

describe.skipIf(!RLS_E2E)(
  'T4-lite — runWithRlsContext + withOrgScope isolate via the app pool',
  () => {
    let ownerConn: ReturnType<typeof ownerConnection>;
    let fixture: TwoOrgFixture;
    let leadAId: string;

    beforeAll(async () => {
      ownerConn = ownerConnection();
      fixture = await createTwoOrgs(ownerConn.db, 'rls-t4');
      leadAId = await seedLead(ownerConn.db, fixture.orgA.id, {
        firstName: 'OrgA',
      });
      await seedLead(ownerConn.db, fixture.orgB.id, { firstName: 'OrgB' });
    });

    afterAll(async () => {
      await fixture.cleanup();
      await ownerConn.client.end();
    });

    it('an ORM findMany scoped to org A returns ONLY org A rows', async () => {
      // No org filter in the query at all — RLS must do the filtering.
      const rows = await runWithRlsContext(
        { organizationId: fixture.orgA.id },
        () =>
          withOrgScope((tx) =>
            tx.query.lead.findMany({
              columns: { id: true, organizationId: true },
            })
          )
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.organizationId === fixture.orgA.id)).toBe(
        true
      );
      expect(rows.map((r) => r.id)).toContain(leadAId);
    });

    it('a targeted ORM read of org B row from org A context returns nothing', async () => {
      const leadBId = await seedLead(ownerConn.db, fixture.orgB.id);
      const rows = await runWithRlsContext(
        { organizationId: fixture.orgA.id },
        () =>
          withOrgScope((tx) =>
            tx.query.lead.findMany({ where: eq(lead.id, leadBId) })
          )
      );
      expect(rows).toHaveLength(0);
    });

    it('withOrgScope without a context fail-fasts (no silent cross-org read)', async () => {
      await expect(
        withOrgScope((tx) => tx.query.lead.findMany())
      ).rejects.toThrow(/organization context/i);
    });

    it('IGNORES a threaded owner db under enforcement (uses the role pool)', async () => {
      // The wave-1 codemod threads the controller's db ({ db }) into every
      // helper. Under enforcement that db is the OWNER pool (bypasses RLS), so
      // the helper MUST ignore it and use app_authenticated — otherwise nothing
      // is isolated. Pass the owner connection explicitly; org B's row must
      // still be invisible from org A's context.
      const leadBId = await seedLead(ownerConn.db, fixture.orgB.id);
      const rows = await runWithRlsContext(
        { organizationId: fixture.orgA.id },
        () =>
          withOrgScope(
            (tx) => tx.query.lead.findMany({ where: eq(lead.id, leadBId) }),
            { db: ownerConn.db }
          )
      );
      expect(rows).toHaveLength(0);
    });
  }
);
