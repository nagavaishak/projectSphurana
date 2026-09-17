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
import { ErrorCodes } from '../../../shared/index.js';

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { addSalePayment } from './add-sale-payment.service.js';

describe('addSalePayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const openSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    currency: 'eur',
    totalCents: 5000,
    items: [],
    payments: [],
  };

  it('settles a cash payment immediately', async () => {
    mockDb.query.sale.findFirst
      .mockResolvedValueOnce(openSale)
      .mockResolvedValueOnce({
        ...openSale,
        payments: [{ id: 'pay_1', method: 'cash', status: 'succeeded' }],
      });

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'cash',
        amountCents: 5000,
      })
    ).toSucceedWith((data) => {
      expect(data.payments).toHaveLength(1);
    });
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.status).toBe('succeeded');
  });

  it('redeems a gift card atomically', async () => {
    mockDb.query.sale.findFirst
      .mockResolvedValueOnce(openSale)
      .mockResolvedValueOnce({
        ...openSale,
        payments: [{ id: 'pay_1', method: 'gift_card', status: 'succeeded' }],
      });
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      organizationId: 'org_123',
      code: 'GC-AAAA-BBBB-CCCC',
      currency: 'eur',
      balanceCents: 6000,
      expiresAt: null,
    });
    // The atomic conditional decrement returns the affected row id.
    mockDb.returning.mockResolvedValueOnce([{ id: 'gc_1' }]);

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'gift_card',
        amountCents: 5000,
        giftCardCode: 'GC-AAAA-BBBB-CCCC',
      })
    ).toSucceedWith((data) => {
      expect(data.payments).toHaveLength(1);
    });

    // payment row + negative redeem ledger row
    const inserts = mockDb.values.mock.calls.map((call) => call[0]);
    expect(inserts[0].method).toBe('gift_card');
    expect(inserts[1].type).toBe('redeem');
    expect(inserts[1].amountCents).toBe(-5000);
    // Balance decremented via a race-safe conditional SQL update (not a
    // read-then-write), so the balance is set to an SQL expression.
    expect(mockDb.set).toHaveBeenCalled();
  });

  it('rejects a gift card whose currency does not match the sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      currency: 'usd',
      balanceCents: 10000,
      expiresAt: null,
    });

    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'gift_card',
      amountCents: 5000,
      giftCardCode: 'GC-AAAA-BBBB-CCCC',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('a pending sibling tender does NOT block a new tender (balance counts captured money only)', async () => {
    // The cashier showed a QR (pending for the full total) then switched to
    // manual card. The pending QR is an in-flight intent, not captured money, so
    // it must NOT count against the balance — the new card tender proceeds and
    // the QR is left untouched (no abandon). If both ever capture, the surplus
    // is refunded at settlement, not prevented here.
    const pendingQr = {
      id: 'pay_qr',
      method: 'qr_self_checkout',
      status: 'pending',
      amountCents: 5000,
      stripePaymentIntentId: null,
      stripePaymentLinkId: 'plink_1',
    };
    mockDb.query.sale.findFirst
      // 1. initial load — QR pending (does not reduce the balance)
      .mockResolvedValueOnce({ ...openSale, payments: [pendingQr] })
      // 2. final reload after the card PI is created
      .mockResolvedValueOnce({
        ...openSale,
        payments: [
          pendingQr,
          { id: 'pay_card', method: 'manual_card', status: 'pending' },
        ],
      });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValue({
      stripeAccountId: 'acct_1',
      isActive: true,
      chargesEnabled: true,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_card' }]);
    mockStripeConnectService.createCardPaymentIntent.mockResolvedValueOnce({
      id: 'pi_card',
      clientSecret: 'pi_card_secret',
      status: 'requires_payment_method',
    });

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'manual_card',
        amountCents: 5000,
      })
    ).toSucceedWith((data) => {
      expect(data.cardClientSecret).toBe('pi_card_secret');
    });

    // The pending QR is left alone — no abandon on switch.
    expect(
      mockStripeConnectService.deactivatePaymentLink
    ).not.toHaveBeenCalled();
    expect(
      mockStripeConnectService.expireOpenPaymentLinkSessions
    ).not.toHaveBeenCalled();
  });

  it('rejects gift card redemption with insufficient balance', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      currency: 'eur',
      balanceCents: 1000,
      expiresAt: null,
    });

    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'gift_card',
      amountCents: 5000,
      giftCardCode: 'GC-AAAA-BBBB-CCCC',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('rejects an expired gift card', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.giftCard.findFirst.mockResolvedValueOnce({
      id: 'gc_1',
      currency: 'eur',
      balanceCents: 10000,
      expiresAt: new Date('2020-01-01'),
    });

    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'gift_card',
      amountCents: 5000,
      giftCardCode: 'GC-AAAA-BBBB-CCCC',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('creates a Terminal PaymentIntent for card_terminal tenders', async () => {
    mockDb.query.sale.findFirst
      .mockResolvedValueOnce(openSale)
      .mockResolvedValueOnce({
        ...openSale,
        payments: [{ id: 'pay_1', method: 'card_terminal', status: 'pending' }],
      });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      stripeAccountId: 'acct_1',
      isActive: true,
      chargesEnabled: true,
    });
    // The pending row is inserted FIRST (returning its id) so the id can be
    // threaded into the PaymentIntent metadata.
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_1' }]);
    mockStripeConnectService.createTerminalPaymentIntent.mockResolvedValueOnce({
      id: 'pi_1',
      clientSecret: 'pi_1_secret',
      status: 'requires_payment_method',
    });

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'card_terminal',
        amountCents: 5000,
        readerType: 'tap_to_pay',
      })
    ).toSucceedWith((data) => {
      expect(data.terminalClientSecret).toBe('pi_1_secret');
    });
    const inserted = mockDb.values.mock.calls[0][0];
    expect(inserted.readerType).toBe('tap_to_pay');
    expect(inserted.status).toBe('pending');
    // The Terminal PI metadata carries the sale_payment row id so the connect
    // webhook can settle it (H1).
    const piArgs =
      mockStripeConnectService.createTerminalPaymentIntent.mock.calls[0][0];
    expect(piArgs.metadata.salePaymentId).toBe('pay_1');
    expect(piArgs.metadata.type).toBe('sale_payment');
    // The PI id is persisted onto the row after creation.
    const piUpdate = mockDb.set.mock.calls[0][0];
    expect(piUpdate.stripePaymentIntentId).toBe('pi_1');
  });

  it('rejects a non-cash tender that exceeds the remaining balance (L1)', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...openSale,
      totalCents: 5000,
      payments: [
        { id: 'pay_1', method: 'cash', status: 'succeeded', amountCents: 3000 },
      ],
    });

    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'card_terminal',
      amountCents: 5000, // remaining is only 2000
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('allows cash to exceed the remaining balance (change given)', async () => {
    mockDb.query.sale.findFirst
      .mockResolvedValueOnce({
        ...openSale,
        totalCents: 5000,
        payments: [],
      })
      .mockResolvedValueOnce({
        ...openSale,
        payments: [{ id: 'pay_1', method: 'cash', status: 'succeeded' }],
      });

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'cash',
        amountCents: 6000, // over the 5000 total — allowed
      })
    ).toSucceedWith((data) => {
      expect(data.payments).toHaveLength(1);
    });
  });

  it('creates a Payment Link for qr_self_checkout tenders', async () => {
    mockDb.query.sale.findFirst
      .mockResolvedValueOnce(openSale)
      .mockResolvedValueOnce({ ...openSale, payments: [{ id: 'pay_1' }] });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      stripeAccountId: 'acct_1',
      isActive: true,
      chargesEnabled: true,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'pay_1' }]);
    mockStripeConnectService.createPaymentLink.mockResolvedValueOnce({
      paymentLinkId: 'plink_1',
      paymentLinkUrl: 'https://buy.stripe.com/xyz',
      productId: 'prod_1',
    });

    await expectResult(
      addSalePayment(mockDb as never, {
        organizationId: 'org_123',
        saleId: 'sale_1',
        method: 'qr_self_checkout',
        amountCents: 5000,
      })
    ).toSucceedWith((data) => {
      expect(data.paymentLinkUrl).toBe('https://buy.stripe.com/xyz');
    });
    const linkArgs =
      mockStripeConnectService.createPaymentLink.mock.calls[0][0];
    expect(linkArgs.metadata.type).toBe('sale_payment');
    expect(linkArgs.metadata.salePaymentId).toBe('pay_1');
    // The Payment Link id is persisted onto the row so an abandoned QR can be
    // deactivated later (it was previously discarded).
    const linkUpdate = mockDb.set.mock.calls.find(
      (call) => call[0]?.stripePaymentLinkId
    );
    expect(linkUpdate?.[0].stripePaymentLinkId).toBe('plink_1');
  });

  it('rejects Stripe tenders when Stripe is not connected', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(openSale);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'card_terminal',
      amountCents: 5000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns VALIDATION_ERROR when gift_card method has no code', async () => {
    const result = await addSalePayment(mockDb as never, {
      organizationId: 'org_123',
      saleId: 'sale_1',
      method: 'gift_card',
      amountCents: 5000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
