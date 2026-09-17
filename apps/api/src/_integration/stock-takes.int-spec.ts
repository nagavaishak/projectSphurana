import request from 'supertest';
/**
 * Fresha domain — stocktakes (asserted over HTTP against a real DB).
 *
 * Moves the persistence coverage of catalog/stocktakes.spec.ts down to the
 * harness. inventory.int-spec.ts explicitly scopes ITSELF to products +
 * stock-orders and leaves the taxonomy/stock-take controllers to a separate
 * task — this is that task for stock-takes.
 *
 * StockTakesController carries only @UseGuards(AuthGuard); every route is
 * org-scoped from the active org on the faked identity, so the enforced
 * boundary is org isolation.
 *
 * Flow proven end to end (matching the E2E create → count → complete):
 *   1. POST /stock-takes snapshots the active trackStock products at a location
 *      into stock_take_item rows (expectedQuantity from product_stock, 0 when
 *      none). The take starts `in_progress`.
 *   2. PUT /stock-takes/:id/items records a counted quantity for the item.
 *   3. POST /stock-takes/:id/complete flips the take to `completed` AND writes
 *      each counted quantity into product_stock at the location — verified by
 *      reading the product's stock level back through ProductsController.
 *
 * Preconditions (a location + a trackStock product) are seeded directly, as the
 * E2E seeds them through the org's own API before driving the UI.
 */
import { ProductsController } from '../inventory/products.controller.js';
import { StockTakesController } from '../inventory/stock-takes.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';
import { seedLocation, seedProduct } from './seeds/inventory.js';

describe('Fresha domain — stocktakes (HTTP)', () => {
  describe('create → count → complete (owner)', () => {
    it('starts a take, records a count, completes it, and writes stock', async () => {
      const owner = await seedOrgWithMember('owner');
      const locationId = await seedLocation({
        organizationId: owner.organizationId,
      });
      const productId = await seedProduct({
        organizationId: owner.organizationId,
        name: 'Countable Product',
        trackStock: true,
      });

      let takeApp: IntegrationApp | undefined;
      let productApp: IntegrationApp | undefined;
      try {
        takeApp = await buildControllerApp(StockTakesController, {
          userId: owner.userId,
          organizationId: owner.organizationId,
        });
        const server = takeApp.app.getHttpServer();

        // create — snapshots the trackStock product (expected 0, no stock yet)
        const created = await request(server).post('/stock-takes').send({
          locationId,
          name: 'Q3 count',
        });
        expect(created.status).toBe(201);
        expect(created.body.status).toBe('in_progress');
        expect(created.body.organizationId).toBe(owner.organizationId);
        expect(created.body.locationId).toBe(locationId);
        expect(Array.isArray(created.body.items)).toBe(true);
        const takeId: string = created.body.id;
        const item = created.body.items.find(
          (i: { productId: string }) => i.productId === productId
        );
        expect(item).toBeDefined();
        expect(item.expectedQuantity).toBe(0);
        const itemId: string = item.id;

        // record a counted quantity for the seeded product
        const counted = await request(server)
          .put(`/stock-takes/${takeId}/items`)
          .send({ items: [{ itemId, countedQuantity: 7 }] });
        expect(counted.status).toBe(200);

        // complete → status flips to completed
        const completed = await request(server).post(
          `/stock-takes/${takeId}/complete`
        );
        expect([200, 201]).toContain(completed.status);
        expect(completed.body.id).toBe(takeId);
        expect(completed.body.status).toBe('completed');
        expect(completed.body.completedAt).not.toBeNull();

        // completing wrote the counted quantity into product_stock
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

        // re-reading the completed take → its status is durably completed
        const reread = await request(server).get(`/stock-takes/${takeId}`);
        expect(reread.status).toBe(200);
        expect(reread.body.status).toBe('completed');
      } finally {
        await productApp?.close();
        await takeApp?.close();
      }
    });
  });

  describe('org isolation + DTO validation', () => {
    it('cross-org complete of an org-B take → 404; empty create body → 400', async () => {
      const orgA = await seedOrgWithMember('owner');
      const orgB = await seedOrgWithMember('owner');
      const bLocation = await seedLocation({
        organizationId: orgB.organizationId,
      });
      await seedProduct({
        organizationId: orgB.organizationId,
        trackStock: true,
      });

      let takeB: IntegrationApp | undefined;
      let takeA: IntegrationApp | undefined;
      try {
        takeB = await buildControllerApp(StockTakesController, {
          userId: orgB.userId,
          organizationId: orgB.organizationId,
        });
        const bTake = await request(takeB.app.getHttpServer())
          .post('/stock-takes')
          .send({ locationId: bLocation });
        expect(bTake.status).toBe(201);
        const bTakeId: string = bTake.body.id;

        takeA = await buildControllerApp(StockTakesController, {
          userId: orgA.userId,
          organizationId: orgA.organizationId,
        });
        const serverA = takeA.app.getHttpServer();

        // org A completing org B's take → 404 (WHERE id AND organizationId)
        const cross = await request(serverA).post(
          `/stock-takes/${bTakeId}/complete`
        );
        expect(cross.status).toBe(404);

        // empty create body → 400 (locationId required)
        const bad = await request(serverA).post('/stock-takes').send({});
        expect(bad.status).toBe(400);
      } finally {
        await takeA?.close();
        await takeB?.close();
      }
    });
  });
});
