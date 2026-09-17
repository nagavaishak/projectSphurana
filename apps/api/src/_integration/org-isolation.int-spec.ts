import request from 'supertest';
/**
 * Batch A — organization isolation (asserted over HTTP against a real DB).
 *
 * For member-open list/get endpoints (offers, leads, organization-services),
 * proves that:
 *   1. A list, performed as a member of org A, returns ONLY org-A rows — zero
 *      org-B rows — even though both orgs hold data in the same shared tables.
 *   2. A GET-by-id of an org-B resource, performed as a member of org A,
 *      returns 404 (the cross-org filter is `id AND organizationId`), so org A
 *      never sees org B's row.
 *
 * The isolation lives in the feature services' WHERE clauses; this batch proves
 * it end to end through the controller + real SQL, with the active org coming
 * from the (faked) auth identity.
 */
import { LeadsController } from '../leads/leads.controller.js';
import { OffersController } from '../offers/offers.controller.js';
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLead,
  seedOffer,
  seedOrgWithMember,
  seedService,
} from './harness.js';

describe('Batch A — organization isolation (HTTP)', () => {
  describe('offers', () => {
    it('list returns only org-A offers; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedOffer({
        organizationId: orgA.organizationId,
        name: 'A-1',
      });
      const a2 = await seedOffer({
        organizationId: orgA.organizationId,
        name: 'A-2',
      });
      const b1 = await seedOffer({
        organizationId: orgB.organizationId,
        name: 'B-1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OffersController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/offers');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((o: { id: string }) => o.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's offer → 404
        const cross = await request(server).get(`/offers/${b1}`);
        expect(cross.status).toBe(404);

        // sanity: org A's own offer IS reachable
        // getOffer wraps the row: { offer, serviceIds, locationIds }.
        const own = await request(server).get(`/offers/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.offer.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('leads', () => {
    it('list returns only org-A leads; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedLead({
        organizationId: orgA.organizationId,
        firstName: 'A-1',
      });
      const a2 = await seedLead({
        organizationId: orgA.organizationId,
        firstName: 'A-2',
      });
      const b1 = await seedLead({
        organizationId: orgB.organizationId,
        firstName: 'B-1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/leads');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((l: { id: string }) => l.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        const cross = await request(server).get(`/leads/${b1}`);
        expect(cross.status).toBe(404);

        const own = await request(server).get(`/leads/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('organization-services', () => {
    it('list returns only org-A services; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedService({
        organizationId: orgA.organizationId,
        name: 'A-1',
      });
      const a2 = await seedService({
        organizationId: orgA.organizationId,
        name: 'A-2',
      });
      const b1 = await seedService({
        organizationId: orgB.organizationId,
        name: 'B-1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/organization-services');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((s: { id: string }) => s.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        const cross = await request(server).get(`/organization-services/${b1}`);
        expect(cross.status).toBe(404);

        const own = await request(server).get(`/organization-services/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });
});
