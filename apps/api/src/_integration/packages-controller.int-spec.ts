import { db, organizationPackage } from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * CHARACTERIZATION — PackagesController (apps/api/src/packages/packages.controller.ts).
 *
 * Written to pin the CURRENT observable behaviour of the controller's create,
 * update, delete, item and isolation routes. Every assertion below passes
 * against today's code; where a write happens the row is READ BACK FROM
 * POSTGRES, not merely inferred from the HTTP response, so a lost write during
 * a refactor fails the net.
 *
 * REAL: HTTP pipeline, ValidationPipe, param decorators, feature services, SQL.
 * FAKED: AuthGuard only (identity stamped by the harness).
 *
 * NO DEPOSIT-LINK LIFECYCLE HERE ANY MORE. This file used to pin ~55 lines of
 * per-package Stripe payment-link orchestration against `depositLink`,
 * `stripePaymentLinkId` and `stripeProductId`. A deposit is no longer a
 * per-package payment link — payment policy resolves in one place — and those
 * three columns are gone, so the tests were asserting on fields
 * organization_package does not have. The link-teardown tests are deleted; the
 * ones covering `requiresDeposit` / `depositAmountCents`, which the package
 * DOES still own, are kept and now assert only those.
 *
 * ROLE BOUNDARY: none to assert. The controller carries `@UseGuards(AuthGuard)`
 * only — no RoleGuard, no @RequireRole — so any authenticated caller with an
 * active org may CRUD. The guard that IS real here is org scoping.
 */
import { PackagesController } from '../packages/packages.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

/** Read the package row straight out of Postgres (org-scoped, like the service). */
const readPackage = async (id: string, organizationId: string) =>
  db.query.organizationPackage.findFirst({
    where: and(
      eq(organizationPackage.id, id),
      eq(organizationPackage.organizationId, organizationId)
    ),
  });

describe('CHARACTERIZATION — packages controller (HTTP + Postgres read-back)', () => {
  describe('POST /packages — create (fat handler)', () => {
    it('persists the package AND its items; response mirrors the stored row', async () => {
      // Protects: the plain create path — dto is merged with the active org id,
      // the package and its item rows land in Postgres with the exact values
      // sent, and the response is the created aggregate (items included).
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
        name: 'Facial',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/packages')
          .send({
            name: 'Facial x3',
            priceCents: 15000,
            validityDays: 90,
            items: [{ serviceId, quantity: 3, sortOrder: 0 }],
          });
        expect(created.status).toBe(201);
        const id: string = created.body.id;
        expect(id).toBeTruthy();
        expect(created.body.name).toBe('Facial x3');
        expect(created.body.priceCents).toBe(15000);
        expect(created.body.validityDays).toBe(90);
        expect(created.body.organizationId).toBe(owner.organizationId);
        // No deposit requested → the deposit branch is skipped entirely.
        expect(created.body.requiresDeposit).toBe(false);
        expect(created.body.items).toHaveLength(1);
        expect(created.body.items[0].serviceId).toBe(serviceId);
        expect(created.body.items[0].quantity).toBe(3);

        // READ BACK FROM POSTGRES — the write really happened.
        const row = await readPackage(id, owner.organizationId);
        expect(row).toBeTruthy();
        expect(row?.name).toBe('Facial x3');
        expect(row?.priceCents).toBe(15000);
        expect(row?.requiresDeposit).toBe(false);

        const items = await db.query.organizationPackageItem.findMany({
          where: (t, { eq: e }) => e(t.packageId, id),
        });
        expect(items).toHaveLength(1);
        expect(items[0].serviceId).toBe(serviceId);
        expect(items[0].quantity).toBe(3);
      } finally {
        await h?.close();
      }
    });

    it('a requested deposit is persisted on the package', async () => {
      // Protects: `requiresDeposit` + `depositAmountCents` survive the round
      // trip. There is no longer a per-package Stripe payment link to
      // provision — payment policy resolves in one place — so what is left to
      // pin is that the two fields the package still owns are stored.
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const created = await request(h.app.getHttpServer())
          .post('/packages')
          .send({
            name: 'Deposit Package',
            priceCents: 40000,
            requiresDeposit: true,
            depositAmountCents: 5000,
            items: [{ serviceId, quantity: 1 }],
          });

        expect(created.status).toBe(201);
        expect(created.body.requiresDeposit).toBe(true);
        expect(created.body.depositAmountCents).toBe(5000);

        const row = await readPackage(created.body.id, owner.organizationId);
        expect(row?.requiresDeposit).toBe(true);
        expect(row?.depositAmountCents).toBe(5000);
      } finally {
        await h?.close();
      }
    });

    it('empty body → 400 (name, priceCents and at least one item are required)', async () => {
      // Protects: DTO validation still runs ahead of the handler after the refactor.
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/packages')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });

  describe('PUT /packages/:id — update (fat handler)', () => {
    it('deposit toggled ON → the toggle and its amount persist', async () => {
      // Protects: turning a deposit on through the update route stores both
      // fields the package owns.
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/packages')
          .send({
            name: 'No Deposit Yet',
            priceCents: 10000,
            items: [{ serviceId, quantity: 1 }],
          });
        const id: string = created.body.id;
        expect(created.body.requiresDeposit).toBe(false);

        const updated = await request(server)
          .put(`/packages/${id}`)
          .send({ requiresDeposit: true, depositAmountCents: 2500 });
        expect(updated.status).toBe(200);
        expect(updated.body.requiresDeposit).toBe(true);
        expect(updated.body.depositAmountCents).toBe(2500);

        const row = await readPackage(id, owner.organizationId);
        expect(row?.requiresDeposit).toBe(true);
        expect(row?.depositAmountCents).toBe(2500);
      } finally {
        await h?.close();
      }
    });

    it('a plain rename leaves the deposit fields alone', async () => {
      // Protects: a partial update touches only what it names. A rename that
      // silently cleared a deposit would change what a customer is charged.
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/packages')
          .send({
            name: 'Before',
            priceCents: 1000,
            items: [{ serviceId, quantity: 1 }],
          });
        const id: string = created.body.id;

        await db
          .update(organizationPackage)
          .set({ requiresDeposit: true, depositAmountCents: 3300 })
          .where(eq(organizationPackage.id, id));

        const updated = await request(server)
          .put(`/packages/${id}`)
          .send({ name: 'After' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('After');
        expect(updated.body.requiresDeposit).toBe(true);
        expect(updated.body.depositAmountCents).toBe(3300);

        const row = await readPackage(id, owner.organizationId);
        expect(row?.name).toBe('After');
        expect(row?.requiresDeposit).toBe(true);
        expect(row?.depositAmountCents).toBe(3300);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DELETE /packages/:id', () => {
    it('deletes the row (and its items) from Postgres', async () => {
      // Protects: delete's pre-step (deactivate a live Stripe link) does not
      // block the delete, and the row genuinely disappears.
      const owner = await seedOrgWithMember('owner');
      const serviceId = await seedService({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/packages')
          .send({
            name: 'Doomed',
            priceCents: 5000,
            items: [{ serviceId, quantity: 1 }],
          });
        const id: string = created.body.id;

        const removed = await request(server).delete(`/packages/${id}`);
        expect(removed.status).toBe(200);
        expect(removed.body).toEqual({ success: true });

        expect(await readPackage(id, owner.organizationId)).toBeUndefined();
        const items = await db.query.organizationPackageItem.findMany({
          where: (t, { eq: e }) => e(t.packageId, id),
        });
        expect(items).toHaveLength(0);

        const gone = await request(server).get(`/packages/${id}`);
        expect(gone.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('package items', () => {
    it('add → reorder → remove all round-trip through Postgres', async () => {
      // Protects: the three item routes write what they claim. Reorder is
      // asserted by the stored sortOrder values, not by response order alone.
      const owner = await seedOrgWithMember('owner');
      const svcA = await seedService({
        organizationId: owner.organizationId,
        name: 'A',
      });
      const svcB = await seedService({
        organizationId: owner.organizationId,
        name: 'B',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/packages')
          .send({
            name: 'Items Package',
            priceCents: 9000,
            items: [{ serviceId: svcA, quantity: 1, sortOrder: 0 }],
          });
        const id: string = created.body.id;
        const firstItemId: string = created.body.items[0].id;

        const added = await request(server)
          .post(`/packages/${id}/items`)
          .send({ serviceId: svcB, quantity: 2, sortOrder: 1 });
        expect(added.status).toBe(201);
        const secondItemId: string = added.body.id;
        expect(added.body.serviceId).toBe(svcB);
        expect(added.body.quantity).toBe(2);

        const reordered = await request(server)
          .post(`/packages/${id}/items/reorder`)
          .send({ orderedIds: [secondItemId, firstItemId] });
        expect(reordered.status).toBe(201);

        const rows = await db.query.organizationPackageItem.findMany({
          where: (t, { eq: e }) => e(t.packageId, id),
        });
        const byId = new Map(rows.map((r) => [r.id, r.sortOrder]));
        expect(byId.get(secondItemId)).toBe(0);
        expect(byId.get(firstItemId)).toBe(1);

        const removedItem = await request(server).delete(
          `/packages/${id}/items/${secondItemId}`
        );
        expect(removedItem.status).toBe(200);
        expect(removedItem.body).toEqual({ success: true });

        const after = await db.query.organizationPackageItem.findMany({
          where: (t, { eq: e }) => e(t.packageId, id),
        });
        expect(after.map((r) => r.id)).toEqual([firstItemId]);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('an org-B package is invisible and immutable to an org-A caller', async () => {
      // Protects: every packages route scopes by the ACTIVE org id, never by the
      // path id alone. If the refactor drops organizationId from any use-case
      // call, this fails.
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bService = await seedService({
        organizationId: orgB.organizationId,
      });

      let hB: IntegrationApp | undefined;
      let hA: IntegrationApp | undefined;
      try {
        hB = await buildControllerApp(PackagesController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bCreated = await request(hB.app.getHttpServer())
          .post('/packages')
          .send({
            name: 'B-only Package',
            priceCents: 7000,
            items: [{ serviceId: bService, quantity: 1 }],
          });
        expect(bCreated.status).toBe(201);
        const bId: string = bCreated.body.id;

        hA = await buildControllerApp(PackagesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = hA.app.getHttpServer();

        const list = await request(serverA).get('/packages');
        expect(list.status).toBe(200);
        expect(list.body.map((p: { id: string }) => p.id)).not.toContain(bId);

        expect((await request(serverA).get(`/packages/${bId}`)).status).toBe(
          NOT_FOUND
        );
        expect(
          (await request(serverA).put(`/packages/${bId}`).send({ name: 'x' }))
            .status
        ).toBe(NOT_FOUND);
        expect((await request(serverA).delete(`/packages/${bId}`)).status).toBe(
          NOT_FOUND
        );

        // …and org B's row is untouched by the attempts above.
        const row = await readPackage(bId, orgB.organizationId);
        expect(row?.name).toBe('B-only Package');
      } finally {
        await hA?.close();
        await hB?.close();
      }
    });

    it('no active organization → 400 on every route', async () => {
      // Protects: requireActiveOrganization's 400 (not a 500 or a silent
      // cross-org read) when the session has no active org.
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(PackagesController, {
          userId: owner.userId,
          organizationId: undefined,
        });
        const server = h.app.getHttpServer();
        expect((await request(server).get('/packages')).status).toBe(
          BAD_REQUEST
        );
        expect((await request(server).get('/packages/anything')).status).toBe(
          BAD_REQUEST
        );
      } finally {
        await h?.close();
      }
    });
  });
});
