import { db, organizationService } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * CHARACTERIZATION — OrganizationServicesController
 * (apps/api/src/organization-services/organization-services.controller.ts).
 *
 * Companion to `catalog-services.int-spec.ts`, which already pins the plain CRUD
 * round-trip, org isolation on get/update, and empty-body validation. This file
 * deliberately does NOT repeat those; it pins the parts that file leaves
 * uncovered — org injection on create, the update pre-read, the delete, the
 * service-variant routes, and the seed route.
 *
 * REAL: HTTP pipeline, ValidationPipe, RoleGuard, feature services, SQL.
 * FAKED: AuthGuard only. Writes are READ BACK FROM POSTGRES.
 *
 * NO DEPOSIT LIFECYCLE HERE ANY MORE. This file used to pin `create`'s deposit
 * branch and `update`'s ~40-line deposit-link lifecycle against `depositLink` /
 * `stripePaymentLinkId` / `stripeProductId` on organization_service. A deposit
 * is no longer a per-service Stripe payment link — payment policy resolves in
 * one place — and those columns are gone, so those tests were asserting on
 * fields the table does not have. Deleted rather than ported: there is no
 * per-service link left to characterize.
 *
 * CLAIRE BOUNDARY: create/update/delete/seed fire `triggerServicesChanged`
 * without awaiting (`void`). It is not observable on the response, so it is not
 * asserted here — a refactor that drops it will NOT be caught by this file.
 *
 * ROLE BOUNDARY: none to assert — the controller has RoleGuard but no
 * @RequireRole on any method, so it is a pass-through for any member.
 */
import { OrganizationServicesController } from '../organization-services/organization-services.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

const readService = async (id: string, organizationId: string) =>
  db.query.organizationService.findFirst({
    where: and(
      eq(organizationService.id, id),
      eq(organizationService.organizationId, organizationId)
    ),
  });

describe('CHARACTERIZATION — organization-services controller (fat handlers)', () => {
  describe('POST /organization-services — create', () => {
    it('create REJECTS a body-supplied organizationId when the session has no active org', async () => {
      // Previously this route was the controller's UNIQUE exception: it fell
      // back to `activeOrganizationId || dto.organizationId`, so a session with
      // NO active org could create a service inside whichever organization the
      // body named. Org-less sessions are reachable (email verification mints
      // them), which made this a cross-tenant write path.
      //
      // The canonical wire contract has no `organizationId` — the org is
      // server-injected only — and the DTO is `.strict()`, so the key is now
      // rejected outright rather than silently honoured. Create behaves like
      // every other route on this controller: no active org, no write.
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: undefined,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/organization-services')
          .send({ name: 'Body-scoped', organizationId: owner.organizationId });
        expect(created.status).toBe(BAD_REQUEST);

        // …and nothing was written into the body-named organization.
        const rows = await db.query.organizationService.findMany({
          where: eq(organizationService.organizationId, owner.organizationId),
        });
        expect(rows.some((r) => r.name === 'Body-scoped')).toBe(false);

        // A read with no active org is rejected outright, as before.
        expect(
          (await request(server).get('/organization-services')).status
        ).toBe(BAD_REQUEST);
        // …and create with neither active org nor body org → 400, as before.
        const noOrg = await request(server)
          .post('/organization-services')
          .send({ name: 'Nowhere' });
        expect(noOrg.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('PUT /organization-services/:id — update', () => {
    it('update on a missing id → 404 from the PRE-update read, and nothing is written', async () => {
      // Protects: the handler's "read current state first" step — the 404 comes
      // from that read, before updateService is ever called.
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .put('/organization-services/svc_does_not_exist')
          .send({ name: 'ghost' });
        expect(res.status).toBe(NOT_FOUND);
        expect(
          await readService('svc_does_not_exist', owner.organizationId)
        ).toBeUndefined();
      } finally {
        await h?.close();
      }
    });
  });

  describe('DELETE /organization-services/:id', () => {
    it('a service is deleted; the row is gone from Postgres', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/organization-services')
          .send({ name: 'Doomed Service' });
        const id: string = created.body.id;
        const removed = await request(server).delete(
          `/organization-services/${id}`
        );
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });
        expect(await readService(id, owner.organizationId)).toBeUndefined();
      } finally {
        await h?.close();
      }
    });
  });

  describe('service variants', () => {
    it('create → list → update → reorder → delete round-trips through Postgres', async () => {
      // Protects: all five variant routes. Reorder is asserted on the STORED
      // sortOrder values, so a refactor that only reorders the response fails.
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const svc = await request(server)
          .post('/organization-services')
          .send({ name: 'Laser' });
        const serviceId: string = svc.body.id;

        const one = await request(server)
          .post(`/organization-services/${serviceId}/variants`)
          .send({ name: '1 Area', priceCents: 9900, sortOrder: 0 });
        expect(one.status).toBe(201);
        expect(one.body.name).toBe('1 Area');
        expect(one.body.priceCents).toBe(9900);
        expect(one.body.serviceId).toBe(serviceId);
        const oneId: string = one.body.id;

        const two = await request(server)
          .post(`/organization-services/${serviceId}/variants`)
          .send({ name: '3 Areas', priceCents: 24900, sortOrder: 1 });
        expect(two.status).toBe(201);
        const twoId: string = two.body.id;

        const list = await request(server).get(
          `/organization-services/${serviceId}/variants`
        );
        expect(list.status).toBe(200);
        // listServiceVariants returns { items } (no pagination meta).
        expect(list.body.items.map((v: { id: string }) => v.id)).toEqual([
          oneId,
          twoId,
        ]);

        const updated = await request(server)
          .put(`/organization-services/variants/${oneId}`)
          .send({ priceCents: 11900, durationMinutes: 45 });
        expect(updated.status).toBe(200);
        expect(updated.body.priceCents).toBe(11900);
        expect(updated.body.durationMinutes).toBe(45);

        const reordered = await request(server)
          .put(`/organization-services/${serviceId}/variants/reorder`)
          .send({ orderedIds: [twoId, oneId] });
        expect(reordered.status).toBe(200);

        const rows = await db.query.organizationServiceVariant.findMany({
          where: (t, { eq: e }) => e(t.serviceId, serviceId),
        });
        const bySortOrder = new Map(rows.map((r) => [r.id, r.sortOrder]));
        expect(bySortOrder.get(twoId)).toBe(0);
        expect(bySortOrder.get(oneId)).toBe(1);
        // the update above really landed in the DB
        expect(rows.find((r) => r.id === oneId)?.priceCents).toBe(11900);

        const removed = await request(server).delete(
          `/organization-services/variants/${twoId}`
        );
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });

        const after = await db.query.organizationServiceVariant.findMany({
          where: (t, { eq: e }) => e(t.serviceId, serviceId),
        });
        expect(after.map((r) => r.id)).toEqual([oneId]);
      } finally {
        await h?.close();
      }
    });

    it("org-B's variants are not readable or mutable from org A", async () => {
      // Protects: the variant routes scope on the ACTIVE org, not just the path
      // ids — the parent service must belong to the caller's org.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      let hB: IntegrationApp | undefined;
      let hA: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(OrganizationServicesController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const serverB = hB.app.getHttpServer();
        const bSvc = await request(serverB)
          .post('/organization-services')
          .send({ name: 'B Laser' });
        const bServiceId: string = bSvc.body.id;
        const bVariant = await request(serverB)
          .post(`/organization-services/${bServiceId}/variants`)
          .send({ name: 'B 1 Area', priceCents: 5000 });
        expect(bVariant.status).toBe(201);
        const bVariantId: string = bVariant.body.id;

        hA = await buildControllerApp(OrganizationServicesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();

        expect(
          (
            await request(serverA).get(
              `/organization-services/${bServiceId}/variants`
            )
          ).status
        ).toBe(NOT_FOUND);
        expect(
          (
            await request(serverA)
              .put(`/organization-services/variants/${bVariantId}`)
              .send({ priceCents: 1 })
          ).status
        ).toBe(NOT_FOUND);
        expect(
          (
            await request(serverA).delete(
              `/organization-services/variants/${bVariantId}`
            )
          ).status
        ).toBe(NOT_FOUND);

        // org B's variant survived every attempt, unchanged.
        const row = await db.query.organizationServiceVariant.findFirst({
          where: (t, { eq: e }) => e(t.id, bVariantId),
        });
        expect(row?.priceCents).toBe(5000);
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });
  });

  describe('POST /organization-services/seed', () => {
    it('seeds the business-type defaults, then skips the ones already present', async () => {
      // Protects: the seed route's {created, skipped} contract and its
      // idempotence — a second call creates nothing and skips the same count.
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const first = await request(server)
          .post('/organization-services/seed')
          .send({ businessType: 'barber' });
        expect(first.status).toBe(201);
        expect(typeof first.body.created).toBe('number');
        expect(first.body.created).toBeGreaterThan(0);
        expect(first.body.skipped).toBe(0);

        const rows = await db.query.organizationService.findMany({
          where: (t, { eq: e }) => e(t.organizationId, owner.organizationId),
        });
        expect(rows).toHaveLength(first.body.created);

        const second = await request(server)
          .post('/organization-services/seed')
          .send({ businessType: 'barber' });
        expect(second.status).toBe(201);
        expect(second.body.created).toBe(0);
        expect(second.body.skipped).toBe(first.body.created);

        const after = await db.query.organizationService.findMany({
          where: (t, { eq: e }) => e(t.organizationId, owner.organizationId),
        });
        expect(after).toHaveLength(first.body.created);
      } finally {
        await h?.close();
      }
    });

    it('seed without an active organization → 400', async () => {
      // Protects: requireActiveOrganization on the seed route (create is the
      // only route with the dto fallback).
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: undefined,
        });
        const res = await request(h.app.getHttpServer())
          .post('/organization-services/seed')
          .send({ businessType: 'barber' });
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('list filtering', () => {
    it('GET ?isActive=false returns only the deactivated services of the org', async () => {
      // Protects: the query DTO is transformed (string → boolean) and forwarded
      // to listServices alongside the active org id.
      const owner = await seedOrgWithMember('owner');
      const activeId = await seedService({
        organizationId: owner.organizationId,
        name: 'Active One',
      });
      const inactiveId = await seedService({
        organizationId: owner.organizationId,
        name: 'Inactive One',
      });
      await db
        .update(organizationService)
        .set({ isActive: false })
        .where(eq(organizationService.id, inactiveId));

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OrganizationServicesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer()).get(
          '/organization-services?isActive=false'
        );
        expect(res.status).toBe(200);
        const ids = res.body.items.map((s: { id: string }) => s.id);
        expect(ids).toContain(inactiveId);
        expect(ids).not.toContain(activeId);
      } finally {
        await h?.close();
      }
    });
  });
});
