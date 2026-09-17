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

import { settleCardPayment } from './settle-card-payment.service.js';

describe('settleCardPayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    saleId: 'sale_1',
    salePaymentId: 'pay_1',
    createdById: 'user_1',
  };

  // A pending manual-card sale_payment row awaiting Stripe confirmation.
  const pendingRow = {
    id: 'pay_1',
    saleId: 'sale_1',
    organizationId: 'org_123',
    status: 'pending',
    method: 'manual_card',
    stripePaymentIntentId: 'pi_1',
    amountCents: 5000,
  };

  const integration = {
    organizationId: 'org_123',
    stripeAccountId: 'acct_1',
    isActive: true,
    chargesEnabled: true,
  };

  // A fully-settled sale returned by loadSaleWithRelations. status !== 'open'
  // so autoCompleteIfFullyPaid short-circuits (no completeSale run).
  const completedSale = {
    id: 'sale_1',
    organizationId: 'org_123',
    status: 'completed',
    currency: 'eur',
    totalCents: 5000,
    items: [],
    payments: [
      {
        id: 'pay_1',
        status: 'succeeded',
        method: 'manual_card',
        amountCents: 5000,
      },
    ],
  };

  it('returns VALIDATION_ERROR for a missing salePaymentId and writes nothing', async () => {
    const result = await settleCardPayment(mockDb as never, {
      ...validInput,
      salePaymentId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    // No lookup, no Stripe call, no DB write on invalid input.
    expect(mockDb.query.salePayment.findFirst).not.toHaveBeenCalled();
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the payment row does not exist', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(undefined);

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the payment belongs to a different sale', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingRow,
      saleId: 'other_sale',
    });

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('is idempotent: an already-succeeded row returns the sale without touching Stripe or updating', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingRow,
      status: 'succeeded',
    });
    // autoCompleteIfFullyPaid load + fallback load both see a completed sale.
    mockDb.query.sale.findFirst.mockResolvedValue(completedSale);

    await expectResult(
      settleCardPayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('completed');
    });

    // The webhook already won the race — we must NOT re-verify or re-flip.
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE for a pending row that is not a manual_card tender', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingRow,
      method: 'card_terminal',
    });

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE for a manual_card row in a terminal (failed) state', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingRow,
      status: 'failed',
    });

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns INVALID_STATE when the row has no associated PaymentIntent', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce({
      ...pendingRow,
      stripePaymentIntentId: null,
    });

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns INVALID_STATE when Stripe is not connected for the org', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(pendingRow);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      undefined
    );

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).not.toHaveBeenCalled();
  });

  it('leaves the row pending (no update) when the PaymentIntent is not yet succeeded', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(pendingRow);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockStripeConnectService.retrievePaymentIntentStatus.mockResolvedValueOnce({
      id: 'pi_1',
      status: 'requires_payment_method',
    });
    // Falls straight through to load-and-return the still-open sale.
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      status: 'open',
      payments: [
        {
          id: 'pay_1',
          status: 'pending',
          method: 'manual_card',
          amountCents: 5000,
        },
      ],
    });

    await expectResult(
      settleCardPayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('open');
    });

    // Verified with Stripe, but NOT captured — the row must stay pending.
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).toHaveBeenCalledTimes(1);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('flips the row to succeeded when Stripe confirms the PaymentIntent captured', async () => {
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(pendingRow);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockStripeConnectService.retrievePaymentIntentStatus.mockResolvedValueOnce({
      id: 'pi_1',
      status: 'succeeded',
    });
    // autoCompleteIfFullyPaid load + fallback load see the (now) completed sale.
    mockDb.query.sale.findFirst.mockResolvedValue(completedSale);

    await expectResult(
      settleCardPayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.status).toBe('completed');
    });

    // Verified the intent against the connected account before trusting it.
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).toHaveBeenCalledWith('acct_1', 'pi_1');

    // The row is flipped to succeeded (the money-critical write).
    expect(mockDb.update).toHaveBeenCalled();
    const setArg = mockDb.set.mock.calls[0][0];
    expect(setArg.status).toBe('succeeded');
  });

  it('refunds the card capture when the sale was already covered by another tender', async () => {
    // The card confirmed and captured, but a sibling tender fully paid the sale
    // first. This capture is surplus → refund it and record it `refunded`
    // rather than overpay the sale.
    mockDb.query.salePayment.findFirst.mockResolvedValueOnce(pendingRow);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      integration
    );
    mockStripeConnectService.retrievePaymentIntentStatus.mockResolvedValueOnce({
      id: 'pi_1',
      status: 'succeeded',
    });
    // The overpayment guard loads the sale: another succeeded tender already
    // covers the full total.
    mockDb.query.sale.findFirst.mockResolvedValue({
      id: 'sale_1',
      organizationId: 'org_123',
      status: 'open',
      currency: 'eur',
      totalCents: 5000,
      items: [],
      payments: [
        { id: 'other', method: 'cash', status: 'succeeded', amountCents: 5000 },
      ],
    });

    await expectResult(
      settleCardPayment(mockDb as never, validInput)
    ).toSucceedWith(() => {});

    // Verified the PI captured, then refunded the surplus on the connected acct.
    expect(
      mockStripeConnectService.retrievePaymentIntentStatus
    ).toHaveBeenCalled();
    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_1',
      paymentIntentId: 'pi_1',
    });
    // The row is recorded refunded, never succeeded.
    expect(mockDb.set.mock.calls[0][0].status).toBe('refunded');
  });

  it('returns INTERNAL_ERROR when the payment lookup throws', async () => {
    mockDb.query.salePayment.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await settleCardPayment(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
