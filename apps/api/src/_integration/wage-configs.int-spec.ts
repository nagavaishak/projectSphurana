import request from 'supertest';
/**
 * Fresha domain — wage configs (asserted over HTTP against a real DB).
 *
 * The controller carries only @UseGuards(AuthGuard); org-scoping is enforced in
 * the service (it verifies the practitioner belongs to the caller's org before
 * creating/returning a config). Three facets:
 *
 *   a. GET-CREATES-DEFAULT — the first GET for an org practitioner materialises
 *      and returns a default wage-config row.
 *   b. UPDATE ROUND-TRIP — PUT sets fields; a subsequent GET reflects them.
 *   c. ORG ISOLATION — GET/PUT for a practitioner in another org → 404 (the
 *      service refuses to touch a practitioner outside the caller's org).
 */
import { WageConfigsController } from '../wage-configs/wage-configs.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedPractitioner,
} from './harness.js';

const NOT_FOUND = 404;

describe('Fresha domain — wage configs (HTTP)', () => {
  describe('get creates a default + update round-trip', () => {
    it('GET materialises a default, PUT updates it, GET reflects it', async () => {
      const owner = await seedOrgWithMember('owner');
      const practitionerId = await seedPractitioner({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(WageConfigsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // first GET materialises a default row
        const initial = await request(server).get(
          `/wage-configs/${practitionerId}`
        );
        expect(initial.status).toBe(200);
        expect(initial.body.practitionerId).toBe(practitionerId);
        expect(initial.body.organizationId).toBe(owner.organizationId);

        // update
        const updated = await request(server)
          .put(`/wage-configs/${practitionerId}`)
          .send({ hourlyRateCents: 3000, overtimeEnabled: true });
        expect(updated.status).toBe(200);
        expect(updated.body.hourlyRateCents).toBe(3000);
        expect(updated.body.overtimeEnabled).toBe(true);

        // GET reflects the update
        const after = await request(server).get(
          `/wage-configs/${practitionerId}`
        );
        expect(after.status).toBe(200);
        expect(after.body.hourlyRateCents).toBe(3000);
        expect(after.body.overtimeEnabled).toBe(true);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it("GET/PUT for another org's practitioner → 404", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bPractitioner = await seedPractitioner({
        organizationId: orgB.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(WageConfigsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const got = await request(server).get(`/wage-configs/${bPractitioner}`);
        expect(got.status).toBe(NOT_FOUND);

        const put = await request(server)
          .put(`/wage-configs/${bPractitioner}`)
          .send({ hourlyRateCents: 9999 });
        expect(put.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });
});
