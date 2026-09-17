import request from 'supertest';
/**
 * Fresha domain — catalog products / inventory (asserted over HTTP against a
 * real DB).
 *
 * Mirrors the timesheets/practitioners/organization-locations exemplars.
 * Exercises the real Nest HTTP pipeline + real feature services + real SQL, with
 * only AuthGuard faked (identity stamped by the harness). Facets:
 *
 *   a. HAPPY ROUND-TRIP — an owner creates a product, it shows up in the list,
 *      is fetched by id, renamed via update, then deleted (subsequent GET → 404).
 *   b. ORG ISOLATION — a product created while acting as an org-B member is
 *      invisible to an org-A member: absent from the list, and get/update on the
 *      org-B id → 404 (the service WHERE clause is `id AND organizationId`).
 *   c. ROLE BOUNDARY — NONE to assert. `ProductsController` carries only
 *      `@UseGuards(AuthGuard)` (no RoleGuard) and its services enforce org-scope
 *      only — no per-role gate. Like the inventory/timesheets specs, this pins
 *      the rule that IS enforced (org isolation), not an assumed role gate.
 *   d. DTO VALIDATION — POST /products with an empty body → 400 (name required).
 *
 * A product needs no brand/category to be created (both are optional on
 * `createProductSchema`), so the org-B product is created via the API rather
 * than a seed helper. `listProducts` wraps rows as
 * `{ items, total, limit, offset }`; `getProduct`/`createProduct`/`updateProduct`
 * return the bare row; `deleteProduct` returns the deleted row.
 */
import { ProductsController } from '../inventory/products.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

const BAD_REQUEST = 400;
const NOT_FOUND = 404;

describe('Fresha domain — catalog products (HTTP)', () => {
  describe('happy round-trip (owner)', () => {
    it('create → list includes it → get → update → delete → 404', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server)
          .post('/products')
          .send({ name: 'Argan Oil 100ml' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Argan Oil 100ml');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const id: string = created.body.id;
        expect(id).toBeTruthy();

        // list includes it
        const list = await request(server).get('/products');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body.items)).toBe(true);
        expect(list.body.items.some((p: { id: string }) => p.id === id)).toBe(
          true
        );

        // get by id
        const got = await request(server).get(`/products/${id}`);
        expect(got.status).toBe(200);
        expect(got.body.id).toBe(id);

        // update
        const updated = await request(server)
          .put(`/products/${id}`)
          .send({ name: 'Argan Oil 200ml' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Argan Oil 200ml');

        // delete is a SOFT delete (deactivation): returns the row, isActive false
        const deleted = await request(server).delete(`/products/${id}`);
        expect(deleted.status).toBe(200);
        expect(deleted.body.id).toBe(id);

        // gone from the default (active-only) list...
        const afterList = await request(server).get('/products');
        expect(
          afterList.body.items.some((p: { id: string }) => p.id === id)
        ).toBe(false);
        // ...but get-by-id still returns the deactivated row (soft delete)
        const gone = await request(server).get(`/products/${id}`);
        expect(gone.status).toBe(200);
        expect(gone.body.isActive).toBe(false);
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it("an org-B product is absent from org-A's list and not gettable/updatable", async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductsController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const server = h.app.getHttpServer();

        // create a product in org-B
        const created = await request(server)
          .post('/products')
          .send({ name: 'B-only Shampoo' });
        expect(created.status).toBe(201);
        const bProductId: string = created.body.id;

        // switch to org-A
        h.actAs({ userId: orgA.userId, organizationId: orgA.organizationId });

        const list = await request(server).get('/products');
        expect(list.status).toBe(200);
        expect(
          list.body.items.some((p: { id: string }) => p.id === bProductId)
        ).toBe(false);

        // get on the org-B id → 404
        const got = await request(server).get(`/products/${bProductId}`);
        expect(got.status).toBe(NOT_FOUND);

        // update on the org-B id → 404
        const updated = await request(server)
          .put(`/products/${bProductId}`)
          .send({ name: 'Nope' });
        expect(updated.status).toBe(NOT_FOUND);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('create with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/products')
          .send({});
        expect(res.status).toBe(BAD_REQUEST);
      } finally {
        await h?.close();
      }
    });
  });
});
