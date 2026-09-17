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

import { purchaseMembership } from './purchase-membership.service.js';

describe('purchaseMembership', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    leadId: 'lead_123',
    planId: 'plan_123',
  };

  const oneTimePlan = {
    id: 'plan_123',
    organizationId: 'org_123',
    name: 'Gold',
    pricingType: 'one_time',
    validFor: '1m',
    priceCents: 10000,
    currency: 'eur',
    sessionCount: 10,
    stripeProductId: null,
    stripePriceId: null,
    isActive: true,
  };

  const recurringPlan = {
    ...oneTimePlan,
    pricingType: 'recurring',
    sessionCount: null,
  };

  const mockLead = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'Jane',
    lastName: 'Doe',
    email: 'jane@example.com',
  };

  const activeIntegration = {
    id: 'int_123',
    organizationId: 'org_123',
    stripeAccountId: 'acct_123',
    isActive: true,
    chargesEnabled: true,
  };

  it('purchases a one_time membership with computed validUntil and sessions', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(oneTimePlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    const inserted = {
      id: 'lm_1',
      planId: 'plan_123',
      sessionsRemaining: 10,
      status: 'active',
    };
    mockDb.returning.mockResolvedValueOnce([inserted]);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionsRemaining: 10,
        stripeSubscriptionId: null,
        status: 'active',
        validUntil: expect.any(Date),
      })
    );
    expect(
      mockStripeConnectService.createConnectedSubscription
    ).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the plan does not exist', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INVALID_STATE when the plan is inactive', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      ...oneTimePlan,
      isActive: false,
    });

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('returns NOT_FOUND when the lead does not exist', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(oneTimePlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(null);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INVALID_STATE for a recurring plan without Stripe Connect', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(recurringPlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(null);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('creates product/price lazily and a subscription for a recurring plan', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(recurringPlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createRecurringPrice.mockResolvedValueOnce({
      productId: 'prod_new',
      priceId: 'price_new',
    });
    mockStripeConnectService.createConnectedCustomer.mockResolvedValueOnce({
      customerId: 'cus_1',
    });
    const periodEnd = new Date('2026-08-06T00:00:00Z');
    mockStripeConnectService.createConnectedSubscription.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      status: 'active',
      currentPeriodEnd: periodEnd,
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'lm_1', stripeSubscriptionId: 'sub_1' },
    ]);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockStripeConnectService.createRecurringPrice).toHaveBeenCalledWith(
      expect.objectContaining({
        connectedAccountId: 'acct_123',
        amountCents: 10000,
        interval: 'month',
        intervalCount: 1,
      })
    );
    expect(
      mockStripeConnectService.createConnectedSubscription
    ).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'cus_1', priceId: 'price_new' })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_1',
        validUntil: periodEnd,
        sessionsRemaining: null,
      })
    );
  });

  it('reuses an existing Stripe price for a recurring plan', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      ...recurringPlan,
      stripeProductId: 'prod_1',
      stripePriceId: 'price_1',
    });
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createConnectedCustomer.mockResolvedValueOnce({
      customerId: 'cus_1',
    });
    mockStripeConnectService.createConnectedSubscription.mockResolvedValueOnce({
      subscriptionId: 'sub_2',
      status: 'active',
      currentPeriodEnd: null,
    });
    mockDb.returning.mockResolvedValueOnce([{ id: 'lm_2' }]);

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(
      mockStripeConnectService.createRecurringPrice
    ).not.toHaveBeenCalled();
    expect(
      mockStripeConnectService.createConnectedSubscription
    ).toHaveBeenCalledWith(expect.objectContaining({ priceId: 'price_1' }));
  });

  it('returns INTERNAL_ERROR when Stripe fails', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(recurringPlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    mockStripeConnectService.createRecurringPrice.mockRejectedValueOnce(
      new Error('Stripe down')
    );

    const result = await purchaseMembership(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing leadId', async () => {
    const result = await purchaseMembership(mockDb as never, {
      ...validInput,
      leadId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
