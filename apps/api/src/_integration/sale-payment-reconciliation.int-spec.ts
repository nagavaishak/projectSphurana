// The Stripe stub must be selected BEFORE the integrations singleton is first
// built (getStripeConnectService reads this at construction). Set it at module
// load, before any request triggers a Stripe-backed tender.
process.env.STRIPE_E2E_STUB = 'true';

import { db, salePayment } from '@borradh-workspace/database';
import { handleSalePaymentWebhook } from '@borradh-workspace/features/sales';
import { eq } from 'drizzle-orm';
import request from 'supertest';
/**
 * Fresha domain — sale-payment RECONCILIATION (real DB + Stripe stub).
 *
 * The money invariant this pins: the sale balance counts ONLY captured money
 * (succeeded tenders); an in-flight card/QR intent never blocks a new tender.
 * Two intents may coexist — if more than one is actually captured, the surplus
 * is REFUNDED at settlement (Stripe can't un-capture on request), so a sale is
 * never paid more than once.
 *
 * Stripe itself is the E2E stub (`STRIPE_E2E_STUB=true`): PaymentIntents settle
 * instantly, refunds/link-deactivation are no-ops. Everything else — the
 * balance SQL, the guarded settlement UPDATEs, auto-complete, and the
 * completion-time cancellation of leftover tenders — is REAL against Postgres.
 *
 * Card/QR tenders need a connected + charges-enabled Stripe account, seeded per
 * org via `seedStripeConnectIntegration`.
 */
import { SalesController } from '../sales/sales.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
  seedService,
} from './harness.js';
import { seedStripeConnectIntegration } from './seeds/payments-infra.js';

interface SalePaymentRow {
  id: string;
  method: string;
  amountCents: number;
  status: string;
}

/** Seed an org (charges-enabled Stripe) + a €20 open sale with one service line. */
async function setupSale(): Promise<{
  h: IntegrationApp;
  server: ReturnType<IntegrationApp['app']['getHttpServer']>;
  saleId: string;
  organizationId: string;
}> {
  const owner = await seedOrgWithMember('owner');
  await seedStripeConnectIntegration({
    organizationId: owner.organizationId,
    chargesEnabled: true,
    detailsSubmitted: true,
  });
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

  return { h, server, saleId, organizationId: owner.organizationId };
}

const rowsFor = (saleId: string) =>
  db.query.salePayment.findMany({ where: eq(salePayment.saleId, saleId) });

describe('Fresha domain — sale-payment reconciliation (real DB + Stripe stub)', () => {
  it('a pending QR does NOT block a manual-card tender (balance = captured money only)', async () => {
    const { h, server, saleId } = await setupSale();
    try {
      // Show a QR for the full balance — a pending intent, not captured money.
      const qr = await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'qr_self_checkout', amountCents: 2000 });
      expect(qr.status).toBe(201);
      expect(qr.body.paymentLinkUrl).toBeTruthy();

      // Switch to manual card for the same full balance. Under the old model
      // this 400'd ("exceeds the remaining balance"); now it must be accepted.
      const card = await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'manual_card', amountCents: 2000 });
      expect(card.status).toBe(201);
      expect(card.body.cardClientSecret).toBeTruthy();
      expect(card.body.status).toBe('open');

      // Both intents coexist as pending rows; the sale is still unpaid.
      const rows = (await rowsFor(saleId)) as SalePaymentRow[];
      const qrRow = rows.find((r) => r.method === 'qr_self_checkout');
      const cardRow = rows.find((r) => r.method === 'manual_card');
      expect(qrRow?.status).toBe('pending');
      expect(cardRow?.status).toBe('pending');
    } finally {
      await h.close();
    }
  });

  it('persists the QR Payment Link id so an abandoned link is deactivatable', async () => {
    const { h, server, saleId } = await setupSale();
    try {
      const qr = await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'qr_self_checkout', amountCents: 2000 });
      expect(qr.status).toBe(201);

      const rows = await rowsFor(saleId);
      const qrRow = rows.find((r) => r.method === 'qr_self_checkout');
      // The link id is persisted (was previously discarded).
      expect(qrRow?.stripePaymentLinkId).toBeTruthy();
    } finally {
      await h.close();
    }
  });

  it('settling a manual card completes the sale and abandons the leftover QR intent', async () => {
    const { h, server, saleId } = await setupSale();
    try {
      await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'qr_self_checkout', amountCents: 2000 });
      const card = await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'manual_card', amountCents: 2000 });
      const cardPaymentId: string = card.body.salePaymentId;
      expect(cardPaymentId).toBeTruthy();

      // Settle the card (stub PI is already 'succeeded') — flips it succeeded
      // and auto-completes the sale.
      const settle = await request(server).post(
        `/sales/${saleId}/payments/${cardPaymentId}/settle-card`
      );
      expect(settle.status).toBe(201);
      expect(settle.body.status).toBe('completed');

      const rows = (await rowsFor(saleId)) as SalePaymentRow[];
      const cardRow = rows.find((r) => r.method === 'manual_card');
      const qrRow = rows.find((r) => r.method === 'qr_self_checkout');
      expect(cardRow?.status).toBe('succeeded');
      // Completing the sale cancelled + failed the leftover QR intent.
      expect(qrRow?.status).toBe('failed');

      // The sale is paid exactly once: one succeeded tender for the total.
      const succeeded = rows.filter((r) => r.status === 'succeeded');
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].amountCents).toBe(2000);
    } finally {
      await h.close();
    }
  });

  it('refunds a surplus capture that lands on a tender abandoned by completion', async () => {
    const { h, server, saleId, organizationId } = await setupSale();
    try {
      // Two card-terminal intents for the full balance (cashier retried / two
      // readers). Neither blocks the other.
      await request(server).post(`/sales/${saleId}/payments`).send({
        method: 'card_terminal',
        amountCents: 2000,
        readerType: 'tap_to_pay',
      });
      await request(server).post(`/sales/${saleId}/payments`).send({
        method: 'card_terminal',
        amountCents: 2000,
        readerType: 'tap_to_pay',
      });

      const pending = (await rowsFor(saleId)) as (SalePaymentRow & {
        stripePaymentIntentId: string | null;
      })[];
      expect(pending.filter((r) => r.status === 'pending')).toHaveLength(2);
      const [tenderA, tenderB] = pending;

      // Tender A settles via its PI webhook → succeeded → auto-completes the
      // sale, which cancels + fails the still-pending tender B.
      const a = await handleSalePaymentWebhook(db, {
        eventType: 'payment_intent.succeeded',
        paymentIntentId: tenderA.stripePaymentIntentId ?? undefined,
        metadata: {
          type: 'sale_payment',
          salePaymentId: tenderA.id,
          organizationId,
        },
      });
      expect(a.success).toBe(true);
      if (a.success) expect(a.data.action).toBe('succeeded');

      // Tender B's capture arrives LATE (client paid the second reader). The
      // sale is already settled, so B is surplus → refunded, never recorded as
      // a second succeeded tender.
      const b = await handleSalePaymentWebhook(db, {
        eventType: 'payment_intent.succeeded',
        paymentIntentId: tenderB.stripePaymentIntentId ?? undefined,
        metadata: {
          type: 'sale_payment',
          salePaymentId: tenderB.id,
          organizationId,
        },
      });
      expect(b.success).toBe(true);
      if (b.success) expect(b.data.action).toBe('refunded');

      const rows = (await rowsFor(saleId)) as SalePaymentRow[];
      const rowA = rows.find((r) => r.id === tenderA.id);
      const rowB = rows.find((r) => r.id === tenderB.id);
      expect(rowA?.status).toBe('succeeded');
      expect(rowB?.status).toBe('refunded');
      // Still paid exactly once — the surplus never counts toward the total.
      expect(rows.filter((r) => r.status === 'succeeded')).toHaveLength(1);
    } finally {
      await h.close();
    }
  });

  it('a QR paid AFTER the sale was settled another way is refunded, not double-counted', async () => {
    const { h, server, saleId, organizationId } = await setupSale();
    try {
      // Show a QR, then take cash for the full balance and complete the sale.
      const qr = await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'qr_self_checkout', amountCents: 2000 });
      expect(qr.status).toBe(201);
      const qrRow = (await rowsFor(saleId)).find(
        (r) => r.method === 'qr_self_checkout'
      );
      expect(qrRow).toBeDefined();
      const qrRowId = qrRow?.id as string;

      await request(server)
        .post(`/sales/${saleId}/payments`)
        .send({ method: 'cash', amountCents: 2000 });
      await request(server).post(`/sales/${saleId}/complete`);

      // The client scans the (now-abandoned) QR and pays anyway.
      const late = await handleSalePaymentWebhook(db, {
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_late_qr',
        metadata: {
          type: 'sale_payment',
          salePaymentId: qrRowId,
          organizationId,
        },
      });
      expect(late.success).toBe(true);
      if (late.success) expect(late.data.action).toBe('refunded');

      const rows = (await rowsFor(saleId)) as SalePaymentRow[];
      expect(rows.find((r) => r.id === qrRowId)?.status).toBe('refunded');
      // Cash is the only captured tender; the sale is paid once.
      const succeeded = rows.filter((r) => r.status === 'succeeded');
      expect(succeeded).toHaveLength(1);
      expect(succeeded[0].method).toBe('cash');
    } finally {
      await h.close();
    }
  });
});
