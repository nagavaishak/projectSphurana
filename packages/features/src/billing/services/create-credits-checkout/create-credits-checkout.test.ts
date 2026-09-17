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

import { createCreditsCheckout } from './create-credits-checkout.service.js';

describe('createCreditsCheckout', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    creditPackageId: 'credits_500',
    quantity: 1,
    successUrl: 'https://app.example.com/billing/success',
    cancelUrl: 'https://app.example.com/billing/cancel',
  };

  const existingSubscription = {
    id: 'sub_123',
    organizationId: 'org_123',
    stripeCustomerId: 'cus_abc123',
    stripeSubscriptionId: 'sub_stripe_123',
    status: 'active',
  };

  const creditPackages = [
    { id: 'credits_500', name: '500 Credits', credits: 50000, price: 2500 },
    { id: 'credits_1000', name: '1000 Credits', credits: 100000, price: 4500 },
  ];

  it('should create checkout session when subscription exists', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.getCreditPackages.mockReturnValueOnce(creditPackages);
    mockStripeService.createCreditsCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createCreditsCheckout(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('cs_test_123');
      expect(result.data.url).toBe('https://checkout.stripe.com/cs_test_123');
    }
    expect(mockStripeService.createCreditsCheckout).toHaveBeenCalledWith({
      organizationId: 'org_123',
      customerId: 'cus_abc123',
      creditPackageId: 'credits_500',
      quantity: 1,
      successUrl: validInput.successUrl,
      cancelUrl: validInput.cancelUrl,
    });
  });

  it('should return SUBSCRIPTION_NOT_FOUND when no subscription exists', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createCreditsCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
      expect(error.message).toContain('subscribe first');
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
      createCreditsCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND);
    });
  });

  it('should return INVALID_CREDIT_PACKAGE when package not found', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.getCreditPackages.mockReturnValueOnce(creditPackages);

    const inputWithInvalidPackage = {
      ...validInput,
      creditPackageId: 'invalid_package',
    };

    await expectResult(
      createCreditsCheckout(mockDb as never, inputWithInvalidPackage)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.INVALID_CREDIT_PACKAGE);
      expect(error.message).toBe('Invalid credit package');
    });
  });

  it('should return STRIPE_CHECKOUT_ERROR when Stripe fails', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      existingSubscription
    );
    mockStripeService.getCreditPackages.mockReturnValueOnce(creditPackages);
    mockStripeService.createCreditsCheckout.mockRejectedValueOnce(
      new Error('Stripe error')
    );

    await expectResult(
      createCreditsCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.STRIPE_CHECKOUT_ERROR);
      expect(error.message).toBe('Failed to create credits checkout session');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      creditPackageId: 'credits_500',
      quantity: 1,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    };

    await expectResult(
      createCreditsCheckout(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing creditPackageId', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      quantity: 1,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    };

    await expectResult(
      createCreditsCheckout(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
