/**
 * Harness smoke test — proves the integration plumbing works end to end:
 *   - testcontainer Postgres is up and migrated
 *   - the db singleton connects to it
 *   - seed helpers insert real rows
 *   - a real Nest app + overridden AuthGuard + real RoleGuard route an HTTP
 *     request, and RoleGuard's real `member` lookup drives the 403 boundary.
 */
import { db, member } from '@borradh-workspace/database';
import request from 'supertest';
import { OffersController } from '../offers/offers.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedMember,
  seedOrgWithMember,
  seedOrganization,
  seedUser,
} from './harness.js';

describe('integration harness smoke', () => {
  it('connects to the test DB and can read a freshly inserted member', async () => {
    const orgId = await seedOrganization();
    const u = await seedUser();
    await seedMember({ organizationId: orgId, userId: u.id, role: 'admin' });

    const row = await db.query.member.findFirst({
      where: (m, { eq, and }) =>
        and(eq(m.userId, u.id), eq(m.organizationId, orgId)),
    });
    expect(row?.role).toBe('admin');
    void member; // ensure schema import is live
  });

  it('boots a controller app and RoleGuard 403s a member on an admin route', async () => {
    const seeded = await seedOrgWithMember('member');
    let harness: IntegrationApp | undefined;
    try {
      harness = await buildControllerApp(OffersController, {
        userId: seeded.userId,
        organizationId: seeded.organizationId,
      });
      const res = await request(harness.app.getHttpServer())
        .post('/offers')
        .send({});
      expect(res.status).toBe(403);
    } finally {
      await harness?.close();
    }
  });
});
