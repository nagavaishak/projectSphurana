/**
 * Phase 3 / T1 — RLS Isolation (the test that justifies the project).
 *
 * Runs ONLY when pointed at a real RLS-enabled database:
 *   - RLS_ENABLED=true
 *   - DATABASE_URL_AUTHENTICATED / _PUBLIC / _SYSTEM (provisioned roles)
 *   - DATABASE_URL (owner, for seeding/teardown)
 * Otherwise every block is skipped, so normal CI stays green.
 *
 * Local run (against the throwaway test DB):
 *   RLS_ENABLED=true \
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/borradh_rls_test \
 *   DATABASE_URL_AUTHENTICATED=postgres://app_authenticated:<pw>@localhost:5432/borradh_rls_test \
 *   DATABASE_URL_PUBLIC=postgres://app_public:<pw>@localhost:5432/borradh_rls_test \
 *   DATABASE_URL_SYSTEM=postgres://app_system:<pw>@localhost:5432/borradh_rls_test \
 *   pnpm --filter @borradh-workspace/database exec vitest run src/__tests__/rls-isolation.test.ts
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../client.js';
import {
  type TwoOrgFixture,
  assertForgedWriteBlocked,
  assertRowNotVisible,
  authConnection,
  ownerConnection,
  seedLead,
  systemConnection,
  withNoOrgScope,
  withRawOrgScope,
} from './rls-harness.js';
import { createTwoOrgs } from './rls-harness.js';

const RLS_E2E =
  process.env.RLS_ENABLED === 'true' &&
  !!process.env.DATABASE_URL_AUTHENTICATED;

describe.skipIf(!RLS_E2E)('T1 — RLS Isolation (RLS_ENABLED=true)', () => {
  let ownerConn: ReturnType<typeof ownerConnection>;
  let authConn: ReturnType<typeof authConnection>;
  let systemConn: ReturnType<typeof systemConnection>;
  let fixture: TwoOrgFixture;

  beforeAll(async () => {
    ownerConn = ownerConnection();
    authConn = authConnection();
    systemConn = systemConnection();
    fixture = await createTwoOrgs(ownerConn.db, 'rls-t1');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await ownerConn.client.end();
    await authConn.client.end();
    await systemConn.client.end();
  });

  it('org A (app_authenticated) cannot read org B leads', async () => {
    const leadBId = await seedLead(ownerConn.db, fixture.orgB.id, {
      firstName: 'OrgB Lead',
    });
    await assertRowNotVisible(authConn.db, fixture.orgA.id, 'lead', leadBId);
  });

  it('org A can read its OWN leads when scoped correctly', async () => {
    const leadAId = await seedLead(ownerConn.db, fixture.orgA.id, {
      firstName: 'OrgA Lead',
    });
    const rows = await withRawOrgScope(authConn.db, fixture.orgA.id, (tx) =>
      (tx as Database).execute(
        `SELECT id FROM lead WHERE id = '${leadAId}'` as never
      )
    );
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(leadAId);
  });

  it('forged organization_id in INSERT is blocked by WITH CHECK', async () => {
    await assertForgedWriteBlocked(
      authConn.db,
      fixture.orgA.id, // scoped to A
      fixture.orgB.id, // forging into B
      'lead',
      `rls-t1-forged-${Date.now()}`,
      { first_name: "'Forged'" }
    );
  });

  it('app_system (BYPASSRLS) sees BOTH orgs', async () => {
    const leadAId = await seedLead(ownerConn.db, fixture.orgA.id);
    const leadBId = await seedLead(ownerConn.db, fixture.orgB.id);
    // No org scope set; BYPASSRLS role should see everything.
    const rows = await withNoOrgScope(systemConn.db, (conn) =>
      (conn as Database).execute(
        `SELECT id FROM lead WHERE id IN ('${leadAId}', '${leadBId}')` as never
      )
    );
    const ids = (rows as unknown as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(leadAId);
    expect(ids).toContain(leadBId);
  });
});
