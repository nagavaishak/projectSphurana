import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { handleSalePaymentWebhook } from './handle-sale-payment-webhook.service.js';

describe('handleSalePaymentWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('marks a pending payment succeeded on checkout completion', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'pending',
      stripePaymentIntentId: null,
    });
    // The idempotent settlement flips the row via a conditional UPDATE ...
    // WHERE status='pending' RETURNING id — 1 row means this call won the race.
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_1' }]);

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_1',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.action).toBe('succeeded');
    });
    const setCall = mockDb.set.mock.calls[0][0];
    expect(setCall.status).toBe('succeeded');
    expect(setCall.stripePaymentIntentId).toBe('pi_1');
  });

  it('ignores events without a salePaymentId', async () => {
    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        metadata: { type: 'sale_payment' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(false);
      expect(data.action).toBe('ignored');
    });
  });

  it('is idempotent for already-settled payments', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'succeeded',
    });
    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        metadata: { salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(false);
      expect(data.action).toBe('ignored');
    });
  });

  it('settles a card-terminal payment on payment_intent.succeeded', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'pending',
      stripePaymentIntentId: 'pi_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_1' }]);

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'payment_intent.succeeded',
        paymentIntentId: 'pi_1',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.action).toBe('succeeded');
    });
    expect(mockDb.set.mock.calls[0][0].status).toBe('succeeded');
  });

  it('marks a card-terminal payment failed on payment_intent.payment_failed', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'pending',
      stripePaymentIntentId: 'pi_1',
    });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'payment_intent.payment_failed',
        paymentIntentId: 'pi_1',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.action).toBe('failed');
    });
    expect(mockDb.set.mock.calls[0][0].status).toBe('failed');
  });

  it('falls back to matching by stripe_payment_intent_id when no metadata id', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'pending',
      stripePaymentIntentId: 'pi_1',
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_1' }]);

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'payment_intent.succeeded',
        paymentIntentId: 'pi_1',
        // no salePaymentId in metadata — must resolve by PI id
        metadata: { type: 'sale_payment' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.salePaymentId).toBe('pay_1');
      expect(data.action).toBe('succeeded');
    });
  });

  it('is idempotent — already-succeeded terminal row is not re-failed', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      status: 'succeeded',
      stripePaymentIntentId: 'pi_1',
    });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'payment_intent.payment_failed',
        paymentIntentId: 'pi_1',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(false);
      expect(data.action).toBe('ignored');
    });
    expect(mockDb.set).not.toHaveBeenCalled();
  });

  /**
   * A refund has to RECORD THE MONEY, not just relabel the tender.
   * `sale_payment.refunded_cents` exists (notNull, default 0), but this handler
   * used to leave it at 0 and never touch the sale — so a fully refunded sale
   * reported the tender as `refunded` with `refundedCents: 0` while the SALE sat
   * at `completed` forever, and a partial refund was dropped on the floor
   * entirely (`processed: false`, no write).
   */
  it('records the refunded amount and marks the SALE refunded on a full charge.refunded', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      saleId: 'sale_1',
      status: 'succeeded',
      amountCents: 5000,
    });
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([
      { refundedCents: 5000 },
    ]);
    mockDb.query.sale.findFirst.mockResolvedValueOnce({ totalCents: 5000 });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'charge.refunded',
        metadata: { salePaymentId: 'pay_1' },
        amountCapturedCents: 5000,
        amountRefundedCents: 5000,
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.action).toBe('refunded');
    });

    const tenderSet = mockDb.set.mock.calls[0][0];
    expect(tenderSet.status).toBe('refunded');
    expect(tenderSet.refundedCents).toBe(5000);

    // The sale itself rolls up to `refunded`.
    expect(mockDb.set.mock.calls[1][0].status).toBe('refunded');
  });

  it('records a PARTIAL charge.refunded without flipping the tender, and marks the sale partially_refunded', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      saleId: 'sale_1',
      status: 'succeeded',
      amountCents: 5000,
    });
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([
      { refundedCents: 2000 },
    ]);
    mockDb.query.sale.findFirst.mockResolvedValueOnce({ totalCents: 5000 });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'charge.refunded',
        metadata: { salePaymentId: 'pay_1' },
        amountCapturedCents: 5000,
        amountRefundedCents: 2000,
      })
    ).toSucceedWith((data) => {
      expect(data.processed).toBe(true);
      expect(data.action).toBe('refunded');
    });

    const tenderSet = mockDb.set.mock.calls[0][0];
    // Still settled — zeroing it out of the day's collected total would be wrong.
    expect(tenderSet.status).toBe('succeeded');
    expect(tenderSet.refundedCents).toBe(2000);

    expect(mockDb.set.mock.calls[1][0].status).toBe('partially_refunded');
  });

  it('refunds a capture that lands on an ABANDONED (failed) tender instead of recording it', async () => {
    // The tender was cancelled when the sale was completed/voided, but Stripe
    // still captured (client tapped Pay in the race). The sale is already
    // settled, so this money is surplus → refund it, mark the row refunded,
    // never `succeeded`.
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_1',
      saleId: 'sale_1',
      status: 'failed',
      amountCents: 2000,
      stripePaymentIntentId: 'pi_1',
    });
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      totalCents: 2000,
      organizationId: 'org_1',
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      stripeAccountId: 'acct_1',
    });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'checkout.session.completed',
        paymentIntentId: 'pi_1',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_1' },
      })
    ).toSucceedWith((data) => {
      expect(data.action).toBe('refunded');
    });

    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_1',
      paymentIntentId: 'pi_1',
    });
    // The row is recorded refunded, never succeeded.
    expect(mockDb.set.mock.calls[0][0].status).toBe('refunded');
  });

  it('refunds the SURPLUS capture when the sale is already fully paid by another tender', async () => {
    // Two intents were live (cashier switched methods); both captured. The
    // second to settle is surplus → recorded succeeded first, then refunded.
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      id: 'pay_2',
      saleId: 'sale_1',
      status: 'pending',
      amountCents: 2000,
      stripePaymentIntentId: 'pi_2',
    });
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      totalCents: 2000,
      organizationId: 'org_1',
    });
    // The pending → succeeded flip wins.
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_2' }]);
    // Post-flip: another tender already fully covers the sale.
    mockDb.query.salePayment.findMany.mockResolvedValueOnce([
      { id: 'pay_1', status: 'succeeded', amountCents: 2000 },
      { id: 'pay_2', status: 'succeeded', amountCents: 2000 },
    ]);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      stripeAccountId: 'acct_1',
    });

    await expectResult(
      handleSalePaymentWebhook(mockDb as never, {
        eventType: 'payment_intent.succeeded',
        paymentIntentId: 'pi_2',
        metadata: { type: 'sale_payment', salePaymentId: 'pay_2' },
      })
    ).toSucceedWith((data) => {
      expect(data.action).toBe('refunded');
    });

    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_1',
      paymentIntentId: 'pi_2',
    });
    // First the flip to succeeded, then the surplus refund.
    expect(mockDb.set.mock.calls[0][0].status).toBe('succeeded');
    expect(mockDb.set.mock.calls[1][0].status).toBe('refunded');
  });
});
