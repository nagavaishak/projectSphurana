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
import { refreshStripeAccount } from './refresh-stripe-account.service.js';

const mockGetAccountInfo = vi.mocked(mockStripeConnectService.getAccountInfo);

describe('refreshStripeAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockGetAccountInfo.mockReset();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  const mockExistingIntegration = {
    id: 'stripe-1',
    organizationId: 'org-123',
    stripeAccountId: 'acct_123',
  };

  it('refreshes Stripe account status successfully', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockExistingIntegration
    );
    mockGetAccountInfo.mockResolvedValueOnce({
      businessName: 'Updated Business',
      email: 'updated@example.com',
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'stripe-1',
        organizationId: 'org-123',
        stripeAccountId: 'acct_123',
        accountName: 'Updated Business',
        chargesEnabled: true,
      },
    ]);

    const result = await refreshStripeAccount(mockDb as never, validInput);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.accountName).toBe('Updated Business');
    }
    expect(mockGetAccountInfo).toHaveBeenCalledWith('acct_123');
  });

  it('returns NOT_FOUND when no integration exists', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      refreshStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      refreshStripeAccount(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when Stripe API fails', async () => {
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      mockExistingIntegration
    );
    mockGetAccountInfo.mockRejectedValueOnce(new Error('Stripe API error'));

    await expectResult(
      refreshStripeAccount(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });
});
