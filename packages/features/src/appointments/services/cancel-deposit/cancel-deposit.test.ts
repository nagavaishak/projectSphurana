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

import { cancelDeposit } from './cancel-deposit.service.js';

describe('cancelDeposit', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    depositId: 'dep_123',
    organizationId: 'org_123',
  };

  const pendingDeposit = {
    id: 'dep_123',
    organizationId: 'org_123',
    appointmentId: 'appt_123',
    status: 'pending',
    stripeCheckoutSessionId: 'cs_123',
    stripeConnectedAccountId: 'acct_123',
    amountCents: 5000,
    currency: 'usd',
  };

  it('should cancel a pending deposit successfully', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      pendingDeposit
    );
    const result = await cancelDeposit(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockStripeConnectService.expireCheckoutSession).toHaveBeenCalledWith(
      'acct_123',
      'cs_123'
    );
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should cancel deposit even without a checkout session', async () => {
    const depositWithoutSession = {
      ...pendingDeposit,
      stripeCheckoutSessionId: null,
    };
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      depositWithoutSession
    );
    const result = await cancelDeposit(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(
      mockStripeConnectService.expireCheckoutSession
    ).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should still cancel when Stripe expiry fails', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      pendingDeposit
    );
    mockStripeConnectService.expireCheckoutSession.mockRejectedValueOnce(
      new Error('Session expired')
    );
    const result = await cancelDeposit(mockDb as never, validInput);
    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should return NOT_FOUND when deposit does not exist', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(null);
    await expectResult(
      cancelDeposit(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return INVALID_STATE when deposit is not pending', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce({
      ...pendingDeposit,
      status: 'paid',
    });
    await expectResult(cancelDeposit(mockDb as never, validInput)).toFailWith(
      (error) => {
        expect(error.code).toBe(ErrorCodes.INVALID_STATE);
        expect(error.message).toContain('paid');
      }
    );
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty depositId', async () => {
    await expectResult(
      cancelDeposit(mockDb as never, {
        depositId: '',
        organizationId: 'org_123',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    await expectResult(
      cancelDeposit(mockDb as never, {
        depositId: 'dep_123',
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.appointmentDeposit.findFirst).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    mockDb.query.appointmentDeposit.findFirst.mockResolvedValueOnce(
      pendingDeposit
    );
    mockDb.update.mockImplementationOnce(() => {
      throw new Error('DB failed');
    });
    await expectResult(
      cancelDeposit(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
