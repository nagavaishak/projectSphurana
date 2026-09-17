import { getStripeService } from '@borradh-workspace/integrations/stripe';
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
import { BillingErrorCodes } from '../../models/billing-error.types.js';

const mockStripeService = vi.mocked(getStripeService());

import { cancelSubscription } from './cancel-subscription.service.js';

describe('cancelSubscription', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const existingSubscription = {
    id: 'sub_123',
    organizationId: 'org_123',
    stripeSubscriptionId: 'sub_stripe_xyz',
    status: 'active' as const,
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
  };

  const stripeResult = {
    id: 'sub_stripe_xyz',
    status: 'active' as const,
    customerId: 'cus_abc',
    priceId: 'price_123',
    currentPeriodStart: new Date(),
    currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    cancelAtPeriodEnd: true,
    canceledAt: new Date(),
    endedAt: null,
  };

  it('should cancel subscription at period end', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.cancelSubscription.mockResolvedValueOnce(stripeResult);

    const result = await cancelSubscription(mockDb as never, {
      organizationId: 'org_123',
      immediate: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cancelAtPeriodEnd).toBe(true);
    }
    expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith(
      'sub_stripe_xyz'
    );
    expect(
      mockStripeService.cancelSubscriptionImmediately
    ).not.toHaveBeenCalled();
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should cancel subscription immediately when immediate=true', async () => {
    const immediateResult = {
      ...stripeResult,
      status: 'canceled' as const,
      cancelAtPeriodEnd: false,
      endedAt: new Date(),
    };

    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.cancelSubscriptionImmediately.mockResolvedValueOnce(
      immediateResult
    );

    const result = await cancelSubscription(mockDb as never, {
      organizationId: 'org_123',
      immediate: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('canceled');
      expect(result.data.endedAt).toBeTruthy();
    }
    expect(
      mockStripeService.cancelSubscriptionImmediately
    ).toHaveBeenCalledWith('sub_stripe_xyz');
    expect(mockStripeService.cancelSubscription).not.toHaveBeenCalled();
  });

  it('should return SUBSCRIPTION_NOT_FOUND when subscription does not exist', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      cancelSubscription(mockDb as never, {
        organizationId: 'org_123',
        immediate: false,
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
    });
  });

  it('should return SUBSCRIPTION_NOT_FOUND when no Stripe subscription ID', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      ...existingSubscription,
      stripeSubscriptionId: null,
    });

    await expectResult(
      cancelSubscription(mockDb as never, {
        organizationId: 'org_123',
        immediate: false,
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
      expect(error.message).toBe('No Stripe subscription ID found');
    });
  });

  it('should return SUBSCRIPTION_INACTIVE when already canceled', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      ...existingSubscription,
      status: 'canceled',
    });

    await expectResult(
      cancelSubscription(mockDb as never, {
        organizationId: 'org_123',
        immediate: false,
      })
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_INACTIVE);
    });
  });

  it('should return INTERNAL_ERROR on Stripe API failure', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.cancelSubscription.mockRejectedValueOnce(
      new Error('Stripe API error')
    );

    await expectResult(
      cancelSubscription(mockDb as never, {
        organizationId: 'org_123',
        immediate: false,
      })
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      cancelSubscription(mockDb as never, {
        organizationId: '',
        immediate: false,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
