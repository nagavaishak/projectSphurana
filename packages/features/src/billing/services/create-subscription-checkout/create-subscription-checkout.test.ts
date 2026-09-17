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

import { createSubscriptionCheckout } from './create-subscription-checkout.service.js';

describe('createSubscriptionCheckout', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    // Default: org has no location on file, so the country-derived billing
    // currency is null and the checkout falls back to the requested currency.
    // Individual tests override this to pin a country → currency.
    mockDb.limit.mockResolvedValue([]);
  });

  const validInput = {
    organizationId: 'org_123',
    customerEmail: 'customer@example.com',
    successUrl: 'https://app.example.com/billing/success',
    cancelUrl: 'https://app.example.com/billing/cancel',
  };

  const existingOrg = {
    id: 'org_123',
    name: 'Test Organization',
    slug: 'test-org',
    createdAt: new Date(),
  };

  it('should create checkout session for new subscription without pre-creating customer', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null); // No existing subscription
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('cs_test_123');
      expect(result.data.url).toBe('https://checkout.stripe.com/cs_test_123');
    }
    // Should NOT pre-create a customer for new orgs (Stripe Checkout handles it)
    expect(mockStripeService.getOrCreateCustomer).not.toHaveBeenCalled();
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith({
      organizationId: 'org_123',
      organizationName: 'Test Organization',
      customerEmail: 'customer@example.com',
      successUrl: validInput.successUrl,
      cancelUrl: validInput.cancelUrl,
      customerId: undefined,
      trialDays: undefined,
      currency: 'usd',
    });
  });

  it('bills an Irish org in EUR regardless of the requested currency', async () => {
    // Regression: an IE clinic on an en-GB device sent currency: 'gbp'. The
    // org's location country must win so the checkout renders in euros.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockDb.limit.mockResolvedValueOnce([{ country: 'ie' }]);
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(mockDb as never, {
      ...validInput,
      currency: 'gbp',
    });

    expect(result.success).toBe(true);
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'eur' })
    );
  });

  it('bills a UK org in GBP', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockDb.limit.mockResolvedValueOnce([{ country: 'gb' }]);
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'gbp' })
    );
  });

  it('bills an existing locked customer in their locked currency, ignoring country', async () => {
    // Safety net for existing orgs: a customer locked to GBP (from a prior
    // invoice) must stay GBP even if the org's country now derives EUR - Stripe
    // rejects a checkout in any other currency. The lock wins over the country.
    const canceledSubscription = {
      id: 'sub_1',
      organizationId: 'org_123',
      stripeCustomerId: 'cus_locked',
      status: 'canceled',
    };
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      canceledSubscription
    );
    // Org country would derive EUR...
    mockDb.limit.mockResolvedValueOnce([{ country: 'ie' }]);
    // ...but the customer is already locked to GBP.
    mockStripeService.getCustomerCurrency.mockResolvedValueOnce('gbp');
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(mockStripeService.getCustomerCurrency).toHaveBeenCalledWith(
      'cus_locked'
    );
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_locked', currency: 'gbp' })
    );
  });

  it('derives country currency for an existing customer with no locked currency', async () => {
    // The pre-created-at-signup customer: has an id but never paid, so no lock.
    // Falls through to the org's country (EUR), not the browser guess.
    const canceledSubscription = {
      id: 'sub_1',
      organizationId: 'org_123',
      stripeCustomerId: 'cus_unlocked',
      status: 'canceled',
    };
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      canceledSubscription
    );
    mockDb.limit.mockResolvedValueOnce([{ country: 'ie' }]);
    mockStripeService.getCustomerCurrency.mockResolvedValueOnce(null);
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(mockDb as never, {
      ...validInput,
      currency: 'gbp',
    });

    expect(result.success).toBe(true);
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_unlocked', currency: 'eur' })
    );
  });

  it('should create checkout with trial days when specified', async () => {
    const inputWithTrial = { ...validInput, trialDays: 30 };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(
      mockDb as never,
      inputWithTrial
    );

    expect(result.success).toBe(true);
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ trialDays: 30 })
    );
  });

  it('should reuse existing customer ID for canceled subscription', async () => {
    const canceledSubscription = {
      id: 'sub_123',
      organizationId: 'org_123',
      stripeCustomerId: 'cus_existing',
      status: 'canceled',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      canceledSubscription
    );
    mockStripeService.createSubscriptionCheckout.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/cs_test_123',
    });

    const result = await createSubscriptionCheckout(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    // Should pass existing customer ID directly, no need to call getOrCreateCustomer
    expect(mockStripeService.getOrCreateCustomer).not.toHaveBeenCalled();
    expect(mockStripeService.createSubscriptionCheckout).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_existing' })
    );
  });

  it('should return NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      createSubscriptionCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Organization not found');
    });
  });

  it('should return SUBSCRIPTION_ALREADY_EXISTS when active subscription exists', async () => {
    const activeSubscription = {
      id: 'sub_123',
      organizationId: 'org_123',
      stripeCustomerId: 'cus_abc123',
      status: 'active',
    };

    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(
      activeSubscription
    );

    await expectResult(
      createSubscriptionCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.SUBSCRIPTION_ALREADY_EXISTS);
      expect(error.message).toContain('already has an active subscription');
    });
  });

  it('should return STRIPE_CHECKOUT_ERROR when Stripe fails', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(existingOrg);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null);
    mockStripeService.createSubscriptionCheckout.mockRejectedValueOnce(
      new Error('Stripe error')
    );

    await expectResult(
      createSubscriptionCheckout(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(BillingErrorCodes.STRIPE_CHECKOUT_ERROR);
      expect(error.message).toBe('Failed to create checkout session');
    });
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      customerEmail: 'customer@example.com',
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    };

    await expectResult(
      createSubscriptionCheckout(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid email', async () => {
    const invalidInput = {
      ...validInput,
      customerEmail: 'invalid-email',
    };

    await expectResult(
      createSubscriptionCheckout(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing successUrl', async () => {
    const invalidInput = {
      organizationId: 'org_123',
      customerEmail: 'customer@example.com',
      cancelUrl: 'https://example.com/cancel',
    };

    await expectResult(
      createSubscriptionCheckout(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
