import request from 'supertest';
/**
 * Fresha domain — inventory (products + stock), asserted over HTTP against a
 * real DB. Exercises the real Nest HTTP pipeline + real feature services + real
 * SQL, with only the AuthGuard faked (identity stamped by the harness).
 *
 * Scope: the two inventory controllers — ProductsController (`/products`) and
 * StockOrdersController (`/stock-orders`). The taxonomy controllers
 * (brands / categories / suppliers / stock-takes) are a separate later task and
 * are NOT covered here.
 *
 * Facets proven end to end:
 *
 *   a. PRODUCT CRUD ROUND-TRIP — create a product, read it back, update it, then
 *      set its stock at a location and read the stock level back.
 *   b. STOCK-ORDER STATE MACHINE — a draft order received in full moves to
 *      `received` AND increments product_stock at its destination location; a
 *      separate draft order cancelled moves to `cancelled`.
 *   c. ORG ISOLATION — the product list, run as an org-A member, returns only
 *      org-A products; a cross-org GET-by-id of an org-B product → 404 (the
 *      service WHERE clause is `id AND organizationId`).
 *   d. DTO VALIDATION — POST /products with an empty body → 400 (name required).
 *
 * ROLE BOUNDARY: there is none to assert. Both controllers carry only
 * `@UseGuards(AuthGuard)` (no RoleGuard) and their services enforce org-scope
 * only — no per-role gate. So, like the timesheets exemplar, this spec pins the
 * rule that IS enforced (org isolation), not an assumed role gate.
 *
 * `listProducts` wraps rows as `{ items, total, limit, offset }`. `getProduct`
 * returns the bare row. `GET /products/:id/stock` returns a bare array of
 * product_stock rows. Stock-order create/receive return
 * `{ ...order, items, fees }`; cancel returns the bare stock_order row.
 */
import { ProductsController } from '../inventory/products.controller.js';
import { StockOrdersController } from '../inventory/stock-orders.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import { seedLocation, seedProduct, seedSupplier } from './seeds/inventory.js';

describe('Fresha domain — inventory (HTTP)', () => {
  describe('product CRUD round-trip (owner)', () => {
    it('create → get → update → adjust stock → read stock level', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });

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
          .send({ name: 'Shampoo', trackStock: true });
        expect(created.status).toBe(201);
        expect(created.body.name).toBe('Shampoo');
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.trackStock).toBe(true);
        const productId: string = created.body.id;
        expect(productId).toBeTruthy();

        // get
        const fetched = await request(server).get(`/products/${productId}`);
        expect(fetched.status).toBe(200);
        expect(fetched.body.id).toBe(productId);
        expect(fetched.body.name).toBe('Shampoo');

        // update
        const updated = await request(server)
          .put(`/products/${productId}`)
          .send({ name: 'Shampoo Deluxe', retailEnabled: true });
        expect(updated.status).toBe(200);
        expect(updated.body.name).toBe('Shampoo Deluxe');
        expect(updated.body.retailEnabled).toBe(true);

        // adjust stock (absolute quantity at a location)
        const adjusted = await request(server)
          .put(`/products/${productId}/stock/${locationId}`)
          .send({ quantity: 25 });
        expect(adjusted.status).toBe(200);
        expect(adjusted.body.productId).toBe(productId);
        expect(adjusted.body.locationId).toBe(locationId);
        expect(adjusted.body.quantity).toBe(25);

        // read stock level back
        const stock = await request(server).get(`/products/${productId}/stock`);
        expect(stock.status).toBe(200);
        expect(Array.isArray(stock.body)).toBe(true);
        const row = stock.body.find(
          (s: { locationId: string }) => s.locationId === locationId
        );
        expect(row).toBeDefined();
        expect(row.quantity).toBe(25);
      } finally {
        await h?.close();
      }
    });
  });

  describe('stock-order state machine (owner)', () => {
    it('receive in full → status received + product_stock incremented', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });
      const supplierId = await seedSupplier({
        organizationId: owner.organizationId,
      });
      const productId = await seedProduct({
        organizationId: owner.organizationId,
        trackStock: true,
      });

      let stockApp: IntegrationApp | undefined;
      let productApp: IntegrationApp | undefined;
      try {
        stockApp = await buildControllerApp(StockOrdersController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const stockServer = stockApp.app.getHttpServer();

        // create a draft order for 10 units at the destination location
        const created = await request(stockServer)
          .post('/stock-orders')
          .send({
            supplierId,
            locationId,
            items: [{ productId, quantity: 10, unitCostCents: 500 }],
          });
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('draft');
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.items).toHaveLength(1);
        expect(created.body.items[0].productId).toBe(productId);
        expect(created.body.items[0].quantity).toBe(10);
        expect(created.body.items[0].receivedQuantity).toBe(0);
        const orderId: string = created.body.id;
        const itemId: string = created.body.items[0].id;

        // receive all 10 → order settles to `received`
        const received = await request(stockServer)
          .post(`/stock-orders/${orderId}/receive`)
          .send({ items: [{ itemId, receivedQuantity: 10 }] });
        expect([200, 201]).toContain(received.status);
        expect(received.body.id).toBe(orderId);
        expect(received.body.status).toBe('received');
        expect(received.body.items[0].receivedQuantity).toBe(10);

        // the receipt incremented product_stock at the destination location
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
        expect(row.quantity).toBe(10);
      } finally {
        await productApp?.close();
        await stockApp?.close();
      }
    });

    it('cancel a draft order → status cancelled', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });
      const productId = await seedProduct({
        organizationId: owner.organizationId,
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(StockOrdersController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = h.app.getHttpServer();

        const created = await request(server)
          .post('/stock-orders')
          .send({
            locationId,
            items: [{ productId, quantity: 5, unitCostCents: 100 }],
          });
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('draft');
        const orderId: string = created.body.id;

        const cancelled = await request(server).post(
          `/stock-orders/${orderId}/cancel`
        );
        expect([200, 201]).toContain(cancelled.status);
        expect(cancelled.body.id).toBe(orderId);
        expect(cancelled.body.status).toBe('cancelled');
      } finally {
        await h?.close();
      }
    });
  });

  describe('org isolation', () => {
    it('product list returns only org-A products; cross-org GET-by-id → 404', async () => {
      const orgA = await seedOrgWithMember('member');
      const orgB = await seedOrgWithMember('member');

      const a1 = await seedProduct({
        organizationId: orgA.organizationId,
        name: 'A-1',
      });
      const a2 = await seedProduct({
        organizationId: orgA.organizationId,
        name: 'A-2',
      });
      const b1 = await seedProduct({
        organizationId: orgB.organizationId,
        name: 'B-1',
      });

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(ProductsController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const server = h.app.getHttpServer();

        const list = await request(server).get('/products');
        expect(list.status).toBe(200);
        const ids = list.body.items.map((p: { id: string }) => p.id).sort();
        expect(ids).toEqual([a1, a2].sort());
        expect(ids).not.toContain(b1);

        // org A asking for org B's product → 404
        const cross = await request(server).get(`/products/${b1}`);
        expect(cross.status).toBe(404);

        // sanity: org A's own product IS reachable
        const own = await request(server).get(`/products/${a1}`);
        expect(own.status).toBe(200);
        expect(own.body.id).toBe(a1);
      } finally {
        await h?.close();
      }
    });
  });

  describe('DTO validation', () => {
    it('POST /products with an empty body → 400', async () => {
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
        expect(res.status).toBe(400);
      } finally {
        await h?.close();
      }
    });
  });
});
