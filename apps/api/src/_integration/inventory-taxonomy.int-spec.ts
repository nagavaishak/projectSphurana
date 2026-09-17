import request from 'supertest';
/**
 * Fresha domain — inventory TAXONOMY (brands / categories / suppliers /
 * stock-takes), asserted over HTTP against a real DB. Exercises the real Nest
 * HTTP pipeline + real feature services + real SQL, with only the AuthGuard
 * faked (identity stamped by the harness).
 *
 * Scope: the four taxonomy controllers NOT covered by inventory.int-spec.ts
 * (products + stock-orders):
 *   - ProductBrandsController      (`/product-brands`)
 *   - ProductCategoriesController  (`/product-categories`)
 *   - SuppliersController          (`/suppliers`)
 *   - StockTakesController         (`/stock-takes`)
 *
 * Facets proven end to end:
 *
 *   a. TAXONOMY CRUD ROUND-TRIP — for brands (full) plus categories and
 *      suppliers (brief): create → list includes it → update → delete → list no
 *      longer includes it.
 *   b. ORG ISOLATION — the list, run as an org-A member, returns only org-A
 *      rows. Brands/categories/suppliers expose NO GET-by-id route, so their
 *      cross-org boundary is pinned via a mutation on an org-B id (PUT → 404,
 *      the service WHERE clause is `id AND organizationId`). Stock-takes DO
 *      expose GET :id, so their boundary is pinned via cross-org GET :id → 404.
 *   c. STOCK-TAKE STATE MACHINE — create an in_progress take over one tracked
 *      product, record a counted quantity, complete it (→ completed) and assert
 *      the counted quantity was reconciled into product_stock at the take's
 *      location; a separate take is cancelled (→ cancelled).
 *   d. DTO VALIDATION — POST /product-brands with an empty body → 400 (name
 *      required; the method ValidationPipe runs after the guard).
 *
 * ROLE BOUNDARY: there is none to assert. All four controllers carry only
 * `@UseGuards(AuthGuard)` (no RoleGuard) and their services enforce org-scope
 * only. So, like the timesheets/inventory exemplars, this spec pins the rule
 * that IS enforced (org isolation), not an assumed role gate.
 *
 * Response shapes:
 *   - list brands/categories/suppliers → bare array (`ok(rows)`).
 *   - create/update brand/category/supplier → bare row; delete → `{ success: true }`.
 *   - listStockTakes → `{ items, total, limit, offset }`.
 *   - getStockTake / create / recordCounts / complete → `{ ...take, items }`;
 *     cancel → the bare stock_take row.
 */
import { ProductBrandsController } from '../inventory/product-brands.controller.js';
import { ProductCategoriesController } from '../inventory/product-categories.controller.js';
import { ProductsController } from '../inventory/products.controller.js';
import { StockTakesController } from '../inventory/stock-takes.controller.js';
import { SuppliersController } from '../inventory/suppliers.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import {
  seedBrand,
  seedCategory,
  seedStockTake,
} from './seeds/inventory-taxonomy.js';
import { seedLocation, seedProduct, seedSupplier } from './seeds/inventory.js';

describe('Fresha domain — inventory taxonomy (HTTP)', () => {
  /* ---------------------------------------------------------------- */
  /* BRANDS                                                            */
  /* ---------------------------------------------------------------- */
  describe('product brands', () => {
    it('CRUD round-trip: create → list → update → delete', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductBrandsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        // create
        const created = await request(server)
          .post('/product-brands')
          .send({ name: 'Wella', description: 'Hair care' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Wella');
        expect(created.body.description).toBe('Hair care');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const brandId: string = created.body.id;
        expect(brandId).toBeTruthy();

        // list includes it
        const list = await request(server).get('/product-brands');
        expect(list.status).toBe(200);
        expect(Array.isArray(list.body)).toBe(true);
        expect(list.body.map((b: { id: string }) => b.id)).toContain(brandId);

        // update
        const updated = await request(server)
          .put(`/product-brands/${brandId}`)
          .send({ name: 'Wella Professionals' });
        expect(updated.status).toBe(200);
        expect(updated.body.id).toBe(brandId);
        expect(updated.body.name).toBe('Wella Professionals');

        // delete
        const removed = await request(server).delete(
          `/product-brands/${brandId}`
        );
        expect(removed.status).toBe(200);
        expect(removed.body.success).toBe(true);

        // list no longer includes it
        const after = await request(server).get('/product-brands');
        expect(after.status).toBe(200);
        expect(after.body.map((b: { id: string }) => b.id)).not.toContain(
          brandId
        );
      } finally {
        await h?.close();
      }
    });

    it('org isolation: list returns only org-A brands; cross-org PUT on org-B brand → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedBrand({
        organizationId: orgA.organizationId,
        name: 'A-1',
      });
      const a2 = await seedBrand({
        organizationId: orgA.organizationId,
        name: 'A-2',
      });
      const b1 = await seedBrand({
        organizationId: orgB.organizationId,
        name: 'B-1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductBrandsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/product-brands');
        expect(list.status).toBe(200);
        const ids = list.body.map((b: { id: string }) => b.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A mutating org B's brand → 404 (service scopes id AND org)
        const cross = await request(server)
          .put(`/product-brands/${b1}`)
          .send({ name: 'hijack' });
        expect(cross.status).toBe(404);

        // sanity: org A's own brand IS reachable via the same mutation
        const own = await request(server)
          .put(`/product-brands/${a1}`)
          .send({ name: 'A-1 renamed' });
        expect(own.status).toBe(200);
        expect(own.body.name).toBe('A-1 renamed');
      } finally {
        await h?.close();
      }
    });

    it('DTO validation: POST /product-brands with an empty body → 400', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductBrandsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const res = await request(h.app.getHttpServer())
          .post('/product-brands')
          .send({});
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* CATEGORIES                                                        */
  /* ---------------------------------------------------------------- */
  describe('product categories', () => {
    it('CRUD round-trip: create → list → update → delete', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductCategoriesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/product-categories')
          .send({ name: 'Shampoos' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Shampoos');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const categoryId: string = created.body.id;

        const list = await request(server).get('/product-categories');
        expect(list.status).toBe(200);
        expect(list.body.map((c: { id: string }) => c.id)).toContain(
          categoryId
        );

        const updated = await request(server)
          .put(`/product-categories/${categoryId}`)
          .send({ name: 'Conditioners' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Conditioners');

        const removed = await request(server).delete(
          `/product-categories/${categoryId}`
        );
        expect(removed.status).toBe(200);
        expect(removed.body.success).toBe(true);

        const after = await request(server).get('/product-categories');
        expect(after.body.map((c: { id: string }) => c.id)).not.toContain(
          categoryId
        );
      } finally {
        await h?.close();
      }
    });

    it('org isolation: cross-org PUT on org-B category → 404; list excludes it', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');
      const a1 = await seedCategory({
        organizationId: orgA.organizationId,
        name: 'A-cat',
      });
      const b1 = await seedCategory({
        organizationId: orgB.organizationId,
        name: 'B-cat',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductCategoriesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/product-categories');
        const ids = list.body.map((c: { id: string }) => c.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);

        const cross = await request(server)
          .put(`/product-categories/${b1}`)
          .send({ name: 'hijack' });
        expect(cross.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* SUPPLIERS                                                         */
  /* ---------------------------------------------------------------- */
  describe('suppliers', () => {
    it('CRUD round-trip: create → list → update → delete', async () => {
      const owner = await seedOrgWithMember('owner');
      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SuppliersController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/suppliers')
          .send({ name: 'Acme Distribution', description: 'Wholesale' });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Acme Distribution');
        expect(created.body.organizationId).toBe(owner.organizationId);
        const supplierId: string = created.body.id;

        const list = await request(server).get('/suppliers');
        expect(list.status).toBe(200);
        expect(list.body.map((s: { id: string }) => s.id)).toContain(
          supplierId
        );

        const updated = await request(server)
          .put(`/suppliers/${supplierId}`)
          .send({ name: 'Acme Wholesale' });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Acme Wholesale');

        const removed = await request(server).delete(
          `/suppliers/${supplierId}`
        );
        expect(removed.status).toBe(200);
        expect(removed.body.success).toBe(true);

        const after = await request(server).get('/suppliers');
        expect(after.body.map((s: { id: string }) => s.id)).not.toContain(
          supplierId
        );
      } finally {
        await h?.close();
      }
    });

    it('org isolation: cross-org PUT on org-B supplier → 404; list excludes it', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');
      const a1 = await seedSupplier({
        organizationId: orgA.organizationId,
        name: 'A-sup',
      });
      const b1 = await seedSupplier({
        organizationId: orgB.organizationId,
        name: 'B-sup',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(SuppliersController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/suppliers');
        const ids = list.body.map((s: { id: string }) => s.id);
        expect(ids).toContain(a1);
        expect(ids).not.toContain(b1);

        const cross = await request(server)
          .put(`/suppliers/${b1}`)
          .send({ name: 'hijack' });
        expect(cross.status).toBe(404);
      } finally {
        await h?.close();
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /* STOCK-TAKES — state machine                                       */
  /* ---------------------------------------------------------------- */
  describe('stock-take state machine (owner)', () => {
    it('create → record counts → complete → counted quantity reconciled into product_stock', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });
      const productId = await seedProduct({
        organizationId: owner.organizationId,
        trackStock: true,
      });

      let takeApp: IntegrationApp | undefined;
      let productApp: IntegrationApp | undefined;
      try {
        takeApp = await buildControllerApp(StockTakesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const takeServer = takeApp.app.getHttpServer();

        // create a stock take over the one tracked product at the location
        const created = await request(takeServer)
          .post('/stock-takes')
          .send({ locationId, productIds: [productId] });
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('in_progress');
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.items).toHaveLength(1);
        // no prior stock row → expectedQuantity snapshot is 0, uncounted
        expect(created.body.items[0].productId).toBe(productId);
        expect(created.body.items[0].expectedQuantity).toBe(0);
        expect(created.body.items[0].countedQuantity).toBeNull();
        const takeId: string = created.body.id;
        const itemId: string = created.body.items[0].id;

        // record a physical count of 7
        const recorded = await request(takeServer)
          .put(`/stock-takes/${takeId}/items`)
          .send({ items: [{ itemId, countedQuantity: 7 }] });
        expect(recorded.status).toBe(200);
        expect(recorded.body.id).toBe(takeId);
        const recItem = recorded.body.items.find(
          (i: { id: string }) => i.id === itemId
        );
        expect(recItem.countedQuantity).toBe(7);

        // complete → status completed + completedAt set
        const completed = await request(takeServer).post(
          `/stock-takes/${takeId}/complete`
        );
        expect([200, 201]).toContain(completed.status);
        expect(completed.body.id).toBe(takeId);
        expect(completed.body.status).toBe('completed');
        expect(completed.body.completedAt).not.toBeNull();

        // the completion wrote the counted quantity into product_stock
        productApp = await buildControllerApp(ProductsController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const stock = await request(productApp.app.getHttpServer()).get(
          `/products/${productId}/stock`
        );
        expect(stock.status).toBe(200);
        const row = stock.body.find(
          (s: { locationId: string }) => s.locationId === locationId
        );
        expect(row).toBeDefined();
        expect(row.quantity).toBe(7);
      } finally {
        await productApp?.close();
        await takeApp?.close();
      }
    });

    it('cancel an in-progress take → status cancelled', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });
      const productId = await seedProduct({
        organizationId: owner.organizationId,
        trackStock: true,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(StockTakesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/stock-takes')
          .send({ locationId, productIds: [productId] });
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('in_progress');
        const takeId: string = created.body.id;

        const cancelled = await request(server).post(
          `/stock-takes/${takeId}/cancel`
        );
        expect([200, 201]).toContain(cancelled.status);
        expect(cancelled.body.id).toBe(takeId);
        expect(cancelled.body.status).toBe('cancelled');
      } finally {
        await h?.close();
      }
    });

    it('org isolation: list returns only org-A takes; cross-org GET :id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedStockTake({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
      });
      const a2 = await seedStockTake({
        organizationId: orgA.organizationId,
        createdById: orgA.userId,
      });
      const b1 = await seedStockTake({
        organizationId: orgB.organizationId,
        createdById: orgB.userId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(StockTakesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/stock-takes');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((t: { id: string }) => t.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's take → 404
        const cross = await request(server).get(`/stock-takes/${b1}`);
        expect(cross.status).toBe(404);

        // sanity: org A's own take IS reachable
        const own = await request(server).get(`/stock-takes/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });
});
