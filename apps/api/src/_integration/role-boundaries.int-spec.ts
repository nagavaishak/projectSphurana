import request from 'supertest';
/**
 * Batch F — role boundaries (the @RequireRole guard, asserted over HTTP).
 *
 * The guard unit tests (role.guard.spec.ts) prove the guard's logic; this
 * batch proves the DECORATORS ARE ACTUALLY WIRED on each route, by driving a
 * real Nest app + real RoleGuard + a real `member` row through HTTP.
 *
 * Model (docs/claire/role-permissions-and-test-plan.md): member < admin <
 * owner; hasMinimumRole is `>=`.
 *   - admin-gated: offers / meta-campaigns / social-posts mutations,
 *     practitioners update/assign.
 *   - owner-gated: practitioners create/delete.
 *
 * Assertion focus is the 403 / not-403 boundary (all the guard controls):
 *   - blocked role  → 403
 *   - allowed role  → NOT 403 (200/201, or a downstream 400/409/500 — the
 *     request passed the guard, which is the fact under test). For routes that
 *     would call out to Meta we only assert "not 403" / send an invalid body so
 *     the method-level ValidationPipe (which runs AFTER guards) short-circuits
 *     before any external call.
 */
import { LeadsController } from '../leads/leads.controller.js';
import { MetaCampaignsController } from '../meta-campaigns/meta-campaigns.controller.js';
import { OffersController } from '../offers/offers.controller.js';
import { OrgDefaultsController } from '../org-defaults/org-defaults.controller.js';
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import { PractitionersController } from '../practitioners/practitioners.controller.js';
import { SocialPostsController } from '../social-posts/social-posts.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedLead,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const FORBIDDEN = 403;

describe('Batch F — role boundaries (HTTP)', () => {
  describe('member is blocked on admin-gated mutations (→ 403)', () => {
    it('offers create', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OffersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/offers')
          .send({ name: 'x', discountType: 'percentage', discountPercent: 10 });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('meta-campaigns create', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(MetaCampaignsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/meta-campaigns')
          .send({});
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('social-posts create', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/social-posts')
          .send({});
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('practitioners update', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put('/practitioners/some-id')
          .send({ displayName: 'x' });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('admin is NOT blocked on the same admin-gated mutations', () => {
    it('offers create → 201 (passes guard, real DB write)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OffersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).post('/offers').send({
          name: 'Admin Offer',
          discountType: 'percentage',
          discountPercent: 15,
        });
        expect(res.status).not.toBe(FORBIDDEN);
        expect(res.status).toBe(201);
        expect(res.body.organizationId).toBe(who.organizationId);
      } finally {
        await h?.close();
      }
    });

    it('meta-campaigns create → not 403 (passes guard; downstream error ok)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(MetaCampaignsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/meta-campaigns')
          .send({});
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('social-posts create → not 403 (passes guard; downstream error ok)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SocialPostsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/social-posts')
          .send({});
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('practitioners update → not 403 (passes guard)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put('/practitioners/missing-id')
          .send({ displayName: 'x' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('owner-only routes (practitioners create / delete)', () => {
    it('admin → 403 on practitioners create (owner-only)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/practitioners')
          .send({ displayName: 'New Prac' });
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → 403 on practitioners delete (owner-only)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          '/practitioners/some-id'
        );
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('owner → NOT 403 on practitioners create (passes guard)', async () => {
      const who = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/practitioners')
          .send({ displayName: 'New Prac' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('owner → NOT 403 on practitioners delete (passes guard)', async () => {
      const who = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PractitionersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          '/practitioners/some-id'
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* Newly-gated controllers (org-defaults / services / leads).       */
  /* These four were missed when role guards were added to the rest   */
  /* of the admin-gated surface.                                      */
  /* ---------------------------------------------------------------- */

  describe('org-defaults — PATCH is admin-gated, GET is open', () => {
    it('member → 403 on PATCH /org-defaults', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch('/org-defaults')
          .send({});
        expect(res.status).toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on PATCH /org-defaults (passes guard)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .patch('/org-defaults')
          .send({});
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on GET /org-defaults (read stays open)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrgDefaultsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/org-defaults');
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('organization-services — members manage services, reads open', () => {
    it('member → not 403 on create (members manage services)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization-services')
          .send({ name: 'Member Service' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on update (members manage services)', async () => {
      const who = await seedOrgWithMember('member');
      const serviceId = await seedService({
        organizationId: who.organizationId,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put(`/organization-services/${serviceId}`)
          .send({ name: 'Renamed' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on delete (members manage services)', async () => {
      const who = await seedOrgWithMember('member');
      const serviceId = await seedService({
        organizationId: who.organizationId,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          `/organization-services/${serviceId}`
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on create (passes guard, real DB write)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization-services')
          .send({ name: 'Admin Service' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on update', async () => {
      const who = await seedOrgWithMember('admin');
      const serviceId = await seedService({
        organizationId: who.organizationId,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put(`/organization-services/${serviceId}`)
          .send({ name: 'Renamed' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on delete', async () => {
      const who = await seedOrgWithMember('admin');
      const serviceId = await seedService({
        organizationId: who.organizationId,
      });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          `/organization-services/${serviceId}`
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on GET list (read stays open)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/organization-services'
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });

  describe('leads — members do full CRUD + stats, reads open', () => {
    it('member → not 403 on create (members do leads CRUD)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/leads')
          .send({ firstName: 'Member Lead' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on update (members do leads CRUD)', async () => {
      const who = await seedOrgWithMember('member');
      const leadId = await seedLead({ organizationId: who.organizationId });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put(`/leads/${leadId}`)
          .send({ firstName: 'Renamed' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on delete (members do leads CRUD)', async () => {
      const who = await seedOrgWithMember('member');
      const leadId = await seedLead({ organizationId: who.organizationId });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          `/leads/${leadId}`
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on import (members do leads CRUD)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/leads/import')
          .send({ leads: [] });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on stats (members read stats)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/leads/stats');
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on create (passes guard, real DB write)', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/leads')
          .send({ firstName: 'Admin Lead' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on update', async () => {
      const who = await seedOrgWithMember('admin');
      const leadId = await seedLead({ organizationId: who.organizationId });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put(`/leads/${leadId}`)
          .send({ firstName: 'Renamed' });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on delete', async () => {
      const who = await seedOrgWithMember('admin');
      const leadId = await seedLead({ organizationId: who.organizationId });
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).delete(
          `/leads/${leadId}`
        );
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on import', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/leads/import')
          .send({ leads: [] });
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('admin → not 403 on stats', async () => {
      const who = await seedOrgWithMember('admin');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/leads/stats');
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });

    it('member → not 403 on GET list (read stays open — story 91)', async () => {
      const who = await seedOrgWithMember('member');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(LeadsController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get('/leads');
        expect(res.status).not.toBe(FORBIDDEN);
      } finally {
        await h?.close();
      }
    });
  });
});
