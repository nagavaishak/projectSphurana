// The Stripe stub must be selected BEFORE the integrations singleton is first
// built (getStripeConnectService reads this at construction). Set it at module
// load, before any request triggers a Stripe-backed tender.
process.env.STRIPE_E2E_STUB = 'true';

import { db, salePayment } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — WHICH TENDERS AN ORG MAY USE (real DB + Stripe stub).
 *
 * The checkout method chooser hides Manual Card Entry and QR Self-Checkout when
 * the org's Connect account cannot take a charge (ENG-827). That is a UI
 * decision, and a UI decision is only safe while the API it mirrors actually
 * refuses those tenders — otherwise the two drift and the next person "fixes"
 * the chooser by showing everything again.
 *
 * So this pins the SERVER half of that contract, which is the half that
 * matters: an org that cannot charge is refused, an org that can is served, and
 * cash/gift-card never consult Stripe at all. The chooser's own behaviour is
 * covered by payment-panel.test.tsx.
 *
 * The refusal is INVALID_STATE, which `SalesController.mapError` sends as 400
 * (sales.controller.ts). The status alone is a weak assertion — plenty of
 * things 400 — so each refusal also asserts that NO `sale_payment` row was
 * written, which distinguishes "the gate turned it away" from "it failed for
 * some other reason on the way in".
 *
 * Stripe is the E2E stub, so the ENABLED cases below prove the request reached
 * intent creation rather than being turned away — the point of the contrast.
 */
import { SalesController } from '../sales/sales.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';
import { seedStripeConnectIntegration } from './seeds/payments-infra.js';

const REFUSED = 400; // INVALID_STATE via SalesController.mapError
const CREATED = 201;

/** Every tender that needs the connected account. */
const STRIPE_TENDERS = ['manual_card', 'qr_self_checkout'] as const;

/**
 * An org with a €20 open sale. `stripe` decides what Connect row it gets:
 * 'none' inserts no row at all (a disconnected org — `disconnectStripe` DELETEs
 * the row, so this is exactly what disconnecting leaves behind).
 */
async function setupSale(
  stripe: 'none' | 'charges-disabled' | 'inactive' | 'charges-enabled'
): Promise<{
  h: IntegrationApp;
  server: ReturnType<IntegrationApp['app']['getHttpServer']>;
  saleId: string;
}> {
  const owner = await seedOrgWithMember('owner');

  if (stripe !== 'none') {
    await seedStripeConnectIntegration({
      organizationId: owner.organizationId,
      chargesEnabled: stripe === 'charges-enabled',
      detailsSubmitted: stripe === 'charges-enabled',
      isActive: stripe !== 'inactive',
    });
  }

  const serviceId = await seedService({
    organizationId: owner.organizationId,
    name: 'Haircut',
  });

  const h = await buildControllerApp(SalesController, {
    userId: owner.userId,
    organizationId: owner.organizationId,
  });
  const server = h.app.getHttpServer();

  const create = await request(server).post('/sales').send({});
  const saleId: string = create.body.id;
  await request(server).post(`/sales/${saleId}/items`).send({
    itemType: 'service',
    serviceId,
    name: 'Haircut',
    quantity: 1,
    unitPriceCents: 2000,
  });

  return { h, server, saleId };
}

const rowsFor = (saleId: string) =>
  db.query.salePayment.findMany({ where: eq(salePayment.saleId, saleId) });

describe('Fresha domain — Stripe tenders require a charge-capable account', () => {
  describe.each([
    ['no Stripe integration at all (disconnected)', 'none'],
    ['a connected account that cannot charge yet', 'charges-disabled'],
    ['an integration row that has been de-activated', 'inactive'],
  ] as const)('%s', (_label, state) => {
    it.each(STRIPE_TENDERS)('refuses %s', async (method) => {
      const { h, server, saleId } = await setupSale(state);
      try {
        const res = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method, amountCents: 2000 });

        expect(res.status).toBe(REFUSED);

        // No half-built tender may survive a refusal. A pending row here would
        // show in the cashier's tender list and, worse, make the sale look
        // mid-payment to the polling checkout.
        expect(await rowsFor(saleId)).toHaveLength(0);
      } finally {
        await h.close();
      }
    });
  });

  describe('an account that can charge', () => {
    it.each(STRIPE_TENDERS)('accepts %s', async (method) => {
      const { h, server, saleId } = await setupSale('charges-enabled');
      try {
        const res = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method, amountCents: 2000 });

        expect(res.status).toBe(CREATED);
        // Proves it reached Stripe intent creation rather than being turned
        // away earlier for some unrelated reason.
        const handle =
          method === 'qr_self_checkout'
            ? res.body.paymentLinkUrl
            : res.body.cardClientSecret;
        expect(handle).toBeTruthy();
      } finally {
        await h.close();
      }
    });
  });

  describe('tenders that never touch Stripe', () => {
    it('settles cash on an org with no Stripe integration at all', async () => {
      // The other half of ENG-827: hiding the card options must not make a
      // clinic unable to take money. Cash is the fallback the chooser leaves.
      const { h, server, saleId } = await setupSale('none');
      try {
        const res = await request(server)
          .post(`/sales/${saleId}/payments`)
          .send({ method: 'cash', amountCents: 2000 });

        expect(res.status).toBe(CREATED);

        const rows = await rowsFor(saleId);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('succeeded');
        expect(rows[0].amountCents).toBe(2000);
      } finally {
        await h.close();
      }
    });
  });
});
