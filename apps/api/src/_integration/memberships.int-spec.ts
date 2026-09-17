import request from 'supertest';
/**
 * Fresha domain — memberships (asserted over HTTP against a real DB).
 *
 * Two controllers, both carrying ONLY `@UseGuards(AuthGuard)` (no RoleGuard,
 * no per-role gate in the services) — so there is no role boundary to pin
 * here; isolation is purely org-scoped via the services' `id AND
 * organizationId` WHERE clauses. Facets proven end to end:
 *
 *   a. PLAN CRUD ROUND-TRIP — an owner creates a plan (cents pricing + fields),
 *      reads it back by id, updates it (PUT), then deletes it. A fresh plan
 *      with no sold memberships is hard-deleted (`deleted:true`), after which
 *      GET-by-id → 404.
 *   b. ORG ISOLATION — the plan list, run as an org-A member, returns ONLY
 *      org-A plans; a cross-org GET-by-id of an org-B plan → 404.
 *   c. LEAD MEMBERSHIP — a seeded org-A lead-membership shows up in the org-A
 *      list (and an org-B one does not); POST :id/cancel flips status →
 *      'cancelled'.
 *   d. DTO VALIDATION — POST /membership-plans with an empty body → 400
 *      (name + priceCents are required; the method ValidationPipe runs after
 *      the guard).
 *
 * Both `listMembershipPlans` and `listLeadMemberships` return the array
 * directly (`ok(items)`), so those GET bodies are bare arrays, not
 * `{ items: [] }`.
 */
import { LeadMembershipsController } from '../memberships/lead-memberships.controller.js';
import { MembershipPlansController } from '../memberships/membership-plans.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import { seedLeadMembership, seedMembershipPlan } from './seeds/memberships.js';

describe('Fresha domain — memberships (HTTP)', () => {
  describe('plan CRUD round-trip (owner)', () => {
    it('POST → GET → PUT → DELETE, with cents pricing preserved', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(MembershipPlansController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server)
          .post('/membership-plans')
          .send({ name: 'Gold', priceCents: 4999, sessionCount: 10 });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Gold');
        expect(created.body.priceCents).toBe(4999);
        expect(created.body.currency).toBe('eur');
        expect(created.body.pricingType).toBe('one_time');
        expect(created.body.validFor).toBe('1m');
        expect(created.body.sessionCount).toBe(10);
        expect(created.body.isActive).toBe(true);
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.serviceIds).toEqual([]);
        const planId: string = created.body.id;
        expect(planId).toBeTruthy();

        // read back by id
        const got = await request(server).get(`/membership-plans/${planId}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(planId);
        expect(got.body.priceCents).toBe(4999);

        // update — new name + cents price
        const updated = await request(server)
          .put(`/membership-plans/${planId}`)
          .send({ name: 'Platinum', priceCents: 9900 });
        expect(updated.status).toBe(200);
        expect(updated.body.id).toBe(planId);
        expect(updated.body.name).toBe('Platinum');
        expect(updated.body.priceCents).toBe(9900);

        // delete — a fresh plan with no sold memberships is hard-deleted
        const deleted = await request(server).delete(
          `/membership-plans/${planId}`
        );
        expect(deleted.status).toBe(200);
        expect(deleted.body.success).toBe(true);
        expect(deleted.body.deleted).toBe(true);
        expect(deleted.body.deactivated).toBe(false);

        // gone
        const afterDelete = await request(server).get(
          `/membership-plans/${planId}`
        );
        expect(afterDelete.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('plan list returns only org-A plans; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedMembershipPlan({
        organizationId: orgA.organizationId,
        name: 'A-1',
        priceCents: 1000,
      });
      const a2 = await seedMembershipPlan({
        organizationId: orgA.organizationId,
        name: 'A-2',
        priceCents: 2000,
      });
      const b1 = await seedMembershipPlan({
        organizationId: orgB.organizationId,
        name: 'B-1',
        priceCents: 3000,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(MembershipPlansController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/membership-plans');
        expect(list.status).toBe(200);
        const ids = list.body.map((p: { id: string }) => p.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's plan → 404
        const cross = await request(server).get(`/membership-plans/${b1}`);
        expect(cross.status).toBe(404);

        // sanity: org A's own plan IS reachable
        const own = await request(server).get(`/membership-plans/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('lead memberships', () => {
    it('list returns only org-A memberships; cancel flips status → cancelled', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const planA = await seedMembershipPlan({
        organizationId: orgA.organizationId,
        name: 'A-plan',
      });
      const planB = await seedMembershipPlan({
        organizationId: orgB.organizationId,
        name: 'B-plan',
      });

      const a1 = await seedLeadMembership({
        organizationId: orgA.organizationId,
        planId: planA,
      });
      const b1 = await seedLeadMembership({
        organizationId: orgB.organizationId,
        planId: planB,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadMembershipsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/lead-memberships');
        expect(list.status).toBe(200);
        const ids = list.body.map((m: { id: string }) => m.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);
        expect(ids).toEqual([a1]);

        // cross-org cancel on org B's membership → 404
        const crossCancel = await request(server).post(
          `/lead-memberships/${b1}/cancel`
        );
        expect(crossCancel.status).toBe(404);

        // own cancel → status becomes 'cancelled'
        const cancelled = await request(server).post(
          `/lead-memberships/${a1}/cancel`
        );
        expect([200, 201]).toContain(cancelled.status);
        expect(cancelled.body.id).toBe(a1);
        expect(cancelled.body.status).toBe('cancelled');

        // and it now reads back as cancelled in the list
        const afterList = await request(server).get('/lead-memberships');
        const a1Row = afterList.body.find((m: { id: string }) => m.id === a1);
        expect(a1Row.status).toBe('cancelled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('POST /membership-plans with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(MembershipPlansController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/membership-plans')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
