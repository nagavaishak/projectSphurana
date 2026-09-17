import { mockStripeConnectService } from '@borradh-workspace/integrations/stripe';
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

import { refundDeposit } from './refund-deposit.service.js';

describe('refundDeposit', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    depositId: 'dep_123',
    organizationId: 'org_123',
  };

  const paidDeposit = {
    id: 'dep_123',
    appointmentId: 'appt_123',
    organizationId: 'org_123',
    amountCents: 5000,
    currency: 'usd',
    status: 'paid',
    stripePaymentIntentId: 'pi_123',
    stripeConnectedAccountId: 'acct_123',
    stripeCheckoutSessionId: 'cs_123',
  };

  const updatedDeposit = {
    ...paidDeposit,
    status: 'refunded',
    refundedAt: new Date(),
  };

  it('should refund a paid deposit successfully', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      paidDeposit
    );
    mockStripeConnectService.createRefund.mockResolvedValueOnce({
      id: 're_123',
    });
    mockDb.returning.mockResolvedValueOnce([updatedDeposit]);

    const result = await refundDeposit(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deposit.status).toBe('refunded');
      expect(result.data.refundId).toBe('re_123');
    }

    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_123',
      paymentIntentId: 'pi_123',
      reason: undefined,
      idempotencyKey: 'deposit-refund:dep_123',
    });
  });

  it('should pass reason to Stripe when provided', async () => {
    const inputWithReason = {
      ...validInput,
      reason: 'requested_by_customer' as const,
    };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      paidDeposit
    );
    mockStripeConnectService.createRefund.mockResolvedValueOnce({
      id: 're_123',
    });
    mockDb.returning.mockResolvedValueOnce([updatedDeposit]);

    const result = await refundDeposit(mockDb as never, inputWithReason);

    expect(result.success).toBe(true);
    expect(mockStripeConnectService.createRefund).toHaveBeenCalledWith({
      connectedAccountId: 'acct_123',
      paymentIntentId: 'pi_123',
      reason: 'requested_by_customer',
      idempotencyKey: 'deposit-refund:dep_123',
    });
  });

  it('should return NOT_FOUND when deposit does not exist', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.NOT_FOUND);
        expect(error.message).toBe('Deposit not found');
      }
    );

    expect(mockStripeConnectService.createRefund).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE when deposit is not paid', async () => {
    const pendingDeposit = { ...paidDeposit, status: 'pending' };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      pendingDeposit
    );

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('pending');
        expect(error.message).toContain('Only paid deposits');
      }
    );

    expect(mockStripeConnectService.createRefund).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE for expired deposit', async () => {
    const expiredDeposit = { ...paidDeposit, status: 'expired' };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      expiredDeposit
    );

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('expired');
      }
    );
  });

  it('should return INVALID_STATE for already refunded deposit', async () => {
    const refundedDeposit = { ...paidDeposit, status: 'refunded' };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      refundedDeposit
    );

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('refunded');
      }
    );
  });

  it('should return INVALID_STATE when deposit has no payment intent', async () => {
    const depositWithoutPI = { ...paidDeposit, stripePaymentIntentId: null };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      depositWithoutPI
    );

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('no payment intent');
      }
    );

    expect(mockStripeConnectService.createRefund).not.toHaveBeenCalled();
  });

  it('should return EXTERNAL_SERVICE_ERROR on Stripe refund failure', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      paidDeposit
    );

    const stripeError = new Error('Charge has already been refunded');
    (stripeError as Record<string, unknown>).type = 'StripeInvalidRequestError';
    mockStripeConnectService.createRefund.mockRejectedValueOnce(stripeError);

    await expectResult(refundDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
        expect(error.message).toContain('Charge has already been refunded');
      }
    );
  });

  it('should return INTERNAL_ERROR on non-Stripe errors', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      paidDeposit
    );
    mockStripeConnectService.createRefund.mockRejectedValueOnce(
      new Error('Network error')
    );

    await expectResult(
      refundDeposit(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for empty depositId', async () => {
    await expectResult(
      refundDeposit(mockDb as never, {
        depositId: '',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      refundDeposit(mockDb as never, {
        depositId: 'dep_123',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for invalid reason', async () => {
    await expectResult(
      refundDeposit(mockDb as never, {
        ...validInput,
        reason: 'invalid_reason' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return INTERNAL_ERROR on database update failure', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      paidDeposit
    );
    mockStripeConnectService.createRefund.mockResolvedValueOnce({
      id: 're_123',
    });
    mockDb.returning.mockRejectedValueOnce(new Error('Database update failed'));

    await expectResult(
      refundDeposit(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
