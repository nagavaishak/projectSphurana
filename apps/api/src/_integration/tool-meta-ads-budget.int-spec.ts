/**
 * TIER 3 — the admin gate on `metaAds.updateBudget`, pinned before anything
 * moves.
 *
 * This is step 3 of "Migrating one capability" in
 * `docs/engineering/capability-architecture.md`: write the integration test
 * against the real endpoint, and it must pass BEFORE the port is switched.
 *
 * WHY THIS PARTICULAR PROPERTY
 * ----------------------------
 * `PUT /meta-campaigns/:metaCampaignId` carries `@RequireRole('admin')`
 * (`meta-campaigns.controller.ts:223`). `meta-ads.adapter.ts` reaches it over
 * the authenticated loopback, and its own header comment says why:
 *
 *   "the loopback carries the org scope and the role guard
 *    (@RequireRole('admin') on PUT /meta-campaigns/:metaCampaignId), which a
 *    direct service call would bypass."
 *
 * So the admin gate on this capability exists ONLY because the port speaks
 * HTTP. Step 4 of the migration replaces that hop with a direct use-case call.
 * Nothing in `AssistantToolsContext` carries the caller's role, and nothing
 * reads `ToolDefinition.policy` — so performing step 4 today would silently
 * convert an admin-only capability into one any member can reach by asking
 * Claire.
 *
 * This spec is the tripwire. `RoleGuard` is REAL in the harness (it queries the
 * `member` table), so these assertions exercise the actual gate, not a mock.
 * If a later change removes the HTTP hop without moving enforcement, the
 * `member is refused` case turns green-to-red and says so.
 */
import request from 'supertest';
import { MetaCampaignsController } from '../meta-campaigns/meta-campaigns.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const FORBIDDEN = 403;

describe('TIER 3 — metaAds.updateBudget admin gate (real RoleGuard, real DB)', () => {
  let app: IntegrationApp;

  afterEach(async () => {
    await app?.close();
  });

  it('refuses a plain member — this is the property the port switch endangers', async () => {
    const { organizationId, userId } = await seedOrgWithMember('member');
    app = await buildControllerApp(MetaCampaignsController, {
      userId,
      organizationId,
    });

    const res = await request(app.app.getHttpServer())
      .put('/meta-campaigns/does-not-matter')
      .send({ dailyBudget: 2000 });

    // RoleGuard rejects before the handler runs, so a non-existent campaign id
    // is fine — 403 must win over 404. If this ever returns 404, the guard
    // stopped running and the gate is gone.
    expect(res.status).toBe(FORBIDDEN);
  });

  it('lets an admin past the guard (403 is about role, not about everything)', async () => {
    const { organizationId, userId } = await seedOrgWithMember('admin');
    app = await buildControllerApp(MetaCampaignsController, {
      userId,
      organizationId,
    });

    const res = await request(app.app.getHttpServer())
      .put('/meta-campaigns/does-not-matter')
      .send({ dailyBudget: 2000 });

    // The campaign does not exist, so this fails downstream — but NOT with 403.
    // Asserting "not forbidden" rather than a specific success code keeps the
    // test about the guard and stops it from silently passing if the guard
    // started rejecting everyone.
    expect(res.status).not.toBe(FORBIDDEN);
  });

  it('refuses an owner-less identity with no active organization', async () => {
    const { userId } = await seedOrgWithMember('admin');
    app = await buildControllerApp(MetaCampaignsController, {
      userId,
      organizationId: undefined,
    });

    const res = await request(app.app.getHttpServer())
      .put('/meta-campaigns/does-not-matter')
      .send({ dailyBudget: 2000 });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
