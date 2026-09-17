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

import { cancelSalePayment } from './cancel-sale-payment.service.js';

describe('cancelSalePayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    saleId: 'sale_1',
    salePaymentId: 'pay_1',
  };

  // A pending QR self-checkout tender: link id set, PI id still null (a QR only
  // gets a PI once it's actually paid).
  const pendingQrRow = {
    id: 'pay_1',
    saleId: 'sale_1',
    organizationId: 'org_123',
    status: 'pending',
    method: 'qr_self_checkout',
    stripePaymentIntentId: null,
    stripePaymentLinkId: 'plink_1',
    amountCents: 2000,
  };

  const integration = {
    organizationId: 'org_123',
    stripeAccountId: 'acct_1',
    isActive: true,
    chargesEnabled: true,
  };

  // The sale reloaded after the cancel — still open, QR tender now failed so it
  // no longer counts against the balance.
  const openSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'open',
    currency: 'eur',
    totalCents: 2000,
    items: [],
    payments: [
      {
        id: 'pay_1',
        status: 'failed',
        method: 'qr_self_checkout',
        amountCents: 2000,
      },
    ],
  };

  it('returns VALIDATION_ERROR for a missing salePaymentId and writes nothing', async () => {
    const result = await cancelSalePayment(mockDb as never, {
      ...validInput,
      salePaymentId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.salePayment.findFirst).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(
      mockStripeConnectService.deactivatePaymentLink
    ).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the payment row does not exist', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(undefined);

    const result = await cancelSalePayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the payment belongs to a different sale', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingQrRow,
      saleId: 'other_sale',
    });

    const result = await cancelSalePayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('abandons a pending QR tender: expires open sessions, deactivates the link, and flips the row to failed', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(pendingQrRow);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockDb.query.sale.findFirst.mockResolvedValue(openSale);

    await expectResult(
      cancelSalePayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('open');
    });

    // Stripe side closed on the connected account: sessions expired FIRST, then
    // the link deactivated so no new scan (or an open session) can pay.
    expect(
      mockStripeConnectService.expireOpenPaymentLinkSessions
    ).toHaveBeenCalledWith('acct_1', 'plink_1');
    expect(mockStripeConnectService.deactivatePaymentLink).toHaveBeenCalledWith(
      'acct_1',
      'plink_1'
    );

    // The row is flipped to failed, freeing the balance for the next tender.
    expect(mockDb.update).toHaveBeenCalled();
    const setArg = mockDb.set.mock.calls[0][0];
    expect(setArg.status).toBe('failed');
  });

  it('is idempotent: an already-succeeded row is left untouched (no Stripe cancel, no update)', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingQrRow,
      status: 'succeeded',
    });
    mockDb.query.sale.findFirst.mockResolvedValue({
      ...openSale,
      payments: [
        {
          id: 'pay_1',
          status: 'succeeded',
          method: 'qr_self_checkout',
          amountCents: 2000,
        },
      ],
    });

    await expectResult(
      cancelSalePayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('open');
    });

    // A settled tender must never be cancelled or overwritten — that would drop
    // captured money.
    expect(
      mockStripeConnectService.deactivatePaymentLink
    ).not.toHaveBeenCalled();
    expect(
      mockStripeConnectService.expireOpenPaymentLinkSessions
    ).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the payment lookup throws', async () => {
    mockDb.query.salePayment.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await cancelSalePayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
