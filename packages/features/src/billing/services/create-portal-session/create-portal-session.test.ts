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

import { createPortalSession } from './create-portal-session.service.js';

describe('createPortalSession', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    returnUrl: 'https://app.example.com/billing',
  };

  const existingSubscription = {
    id: 'sub_123',
    organizationId: 'org_123',
    stripeCustomerId: 'cus_abc123',
    stripeSubscriptionId: 'sub_stripe_123',
    status: 'active',
  };

  it('should create portal session when subscription exists', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.createPortalSession.mockResolvedValueOnce({
      url: 'https://billing.stripe.com/session/portal_123',
    });

    const result = await createPortalSession(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe(
        'https://billing.stripe.com/session/portal_123'
      );
    }
    expect(mockStripeService.createPortalSession).toHaveBeenCalledWith(
      'cus_abc123',
      validInput.returnUrl
    );
  });

  it('should return SUBSCRIPTION_NOT_FOUND when no subscription exists', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createPortalSession(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
      expect(error.message).toContain('No subscription found');
    });
  });

  it('should return SUBSCRIPTION_NOT_FOUND when subscription has no customer ID', async () => {
    const subscriptionWithoutCustomer = {
      ...existingSubscription,
      stripeCustomerId: null,
    };
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      subscriptionWithoutCustomer
    );

    await expectResult(
      createPortalSession(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
    });
  });

  it('should return INTERNAL_ERROR when Stripe fails', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.createPortalSession.mockRejectedValueOnce(
      new Error('Stripe error')
    );

    await expectResult(
      createPortalSession(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('Failed to create billing portal session');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      returnUrl: 'https://example.com/billing',
    };

    await expectResult(
      createPortalSession(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing returnUrl', async () => {
    const invalidInput = {
      organizationId: 'org_123',
    };

    await expectResult(
      createPortalSession(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty organizationId', async () => {
    const invalidInput = {
      organizationId: '',
      returnUrl: 'https://example.com',
    };

    await expectResult(
      createPortalSession(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
