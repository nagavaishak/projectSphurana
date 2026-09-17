import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

const mockStripeConnectService = vi.mocked(getStripeConnectService());

import { cancelLeadMembership } from './cancel-lead-membership.service.js';

describe('cancelLeadMembership', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    leadMembershipId: 'lm_123',
  };

  const oneTimeMembership = {
    id: 'lm_123',
    organizationId: 'org_123',
    status: 'active',
    stripeSubscriptionId: null,
  };

  it('cancels a one_time membership without touching Stripe', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(
      oneTimeMembership
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...oneTimeMembership, status: 'cancelled' },
    ]);

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('cancelled');
    }
    expect(
      mockStripeConnectService.cancelConnectedSubscription
    ).not.toHaveBeenCalled();
  });

  it('cancels the Stripe subscription for a recurring membership', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...oneTimeMembership,
      stripeSubscriptionId: 'sub_1',
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      stripeAccountId: 'acct_123',
    });
    mockStripeConnectService.cancelConnectedSubscription.mockResolvedValueOnce({
      status: 'canceled',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        ...oneTimeMembership,
        stripeSubscriptionId: 'sub_1',
        status: 'cancelled',
      },
    ]);

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(
      mockStripeConnectService.cancelConnectedSubscription
    ).toHaveBeenCalledWith('acct_123', 'sub_1');
  });

  it('still cancels locally when the Stripe cancel fails', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...oneTimeMembership,
      stripeSubscriptionId: 'sub_1',
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      id: 'int_1',
      organizationId: 'org_123',
      stripeAccountId: 'acct_123',
    });
    mockStripeConnectService.cancelConnectedSubscription.mockRejectedValueOnce(
      new Error('already canceled')
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...oneTimeMembership, status: 'cancelled' },
    ]);

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });

  it('returns INVALID_STATE when already cancelled', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      ...oneTimeMembership,
      status: 'cancelled',
    });

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the membership does not exist', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.leadMembership.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await cancelLeadMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
