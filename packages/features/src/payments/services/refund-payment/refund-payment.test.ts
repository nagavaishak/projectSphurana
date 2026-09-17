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

import { refundPayment } from './refund-payment.service.js';

describe('refundPayment', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    paymentId: 'pay_123',
    organizationId: 'org_123',
  };

  const paidPayment = {
    id: 'pay_123',
    organizationId: 'org_123',
    status: 'paid',
    stripePaymentIntentId: 'pi_456',
    stripeConnectedAccountId: 'acct_stripe_123',
    amountCents: 5000,
  };

  it('should refund a paid payment', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);
    mockStripeConnectService.createRefund.mockResolvedValueOnce({
      id: 're_789',
    });
    const updatedPayment = { ...paidPayment, status: 'refunded' };
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([updatedPayment]);

    await expectResult(
      refundPayment(mockDb as never, validInput)
    ).toSucceedWith((data) => {
      expect(data.payment.status).toBe('refunded');
      expect(data.refundId).toBe('re_789');
    });

    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_stripe_123',
      paymentIntentId: 'pi_456',
      reason: undefined,
      idempotencyKey: 'payment-refund:pay_123',
    });
  });

  it('should pass reason to Stripe when provided', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);
    mockStripeConnectService.createRefund.mockResolvedValueOnce({
      id: 're_789',
    });
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      { ...paidPayment, status: 'refunded' },
    ]);

    await refundPayment(mockDb as never, {
      ...validInput,
      reason: 'duplicate',
    });

    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'duplicate' })
    );
  });

  it('should return NOT_FOUND when payment does not exist', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      refundPayment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return INVALID_STATE when payment is not paid', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce({
      ...paidPayment,
      status: 'pending',
    });

    await expectResult(refundPayment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('Cannot refund');
      }
    );
  });

  it('should return INVALID_STATE when no stripePaymentIntentId', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce({
      ...paidPayment,
      stripePaymentIntentId: null,
    });

    await expectResult(refundPayment(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('no payment intent ID');
      }
    );
  });

  it('should return EXTERNAL_SERVICE_ERROR on Stripe error', async () => {
    mockDb.query.payment.findFirst.mockResolvedValueOnce(paidPayment);
    const stripeError = new Error('Refund failed');
    (stripeError as Record<string, unknown>).type = 'StripeInvalidRequestError';
    mockStripeConnectService.createRefund.mockRejectedValueOnce(stripeError);

    await expectResult(
      refundPayment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('should return INTERNAL_ERROR on unexpected error', async () => {
    mockDb.query.payment.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      refundPayment(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for missing paymentId', async () => {
    await expectResult(
      refundPayment(mockDb as never, { organizationId: 'org_123' } as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      refundPayment(mockDb as never, {
        paymentId: 'pay_123',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
