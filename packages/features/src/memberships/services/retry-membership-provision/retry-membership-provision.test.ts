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
import { retryMembershipProvision } from './retry-membership-provision.service.js';

// Drive the REAL `purchaseMembership` (the sibling this service delegates to)
// through the canonical Stripe boundary mock rather than `vi.mock`-ing the
// sibling module — the latter poisons the shared worker graph under
// `isolate: false` (see vite.config.ts MAINTENANCE RULE). No real Stripe is hit.
const mockStripeConnectService = vi.mocked(getStripeConnectService());

describe('retryMembershipProvision', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = { organizationId: 'org_123', saleId: 'sale_123' };

  const oneTimePlan = {
    id: 'plan_1',
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
    id: 'plan_rec',
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

  const membershipItem = {
    id: 'item_1',
    itemType: 'membership',
    membershipPlanId: 'plan_1',
  };

  const completedSale = {
    id: 'sale_123',
    organizationId: 'org_123',
    status: 'completed',
    leadId: 'lead_123',
    items: [membershipItem],
  };

  it('returns NOT_FOUND when the sale does not exist', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(null);

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INVALID_STATE for a non-completed sale', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      status: 'draft',
    });

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('no-ops for a completed but lead-less sale (nothing can own a membership)', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      leadId: null,
    });

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 0, skipped: 0, failed: 0 });
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('ignores non-membership sale lines and lines with no plan', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      items: [
        { id: 'svc', itemType: 'service', membershipPlanId: null },
        {
          id: 'mem_no_plan',
          itemType: 'membership',
          membershipPlanId: null,
        },
      ],
    });

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 0, skipped: 0, failed: 0 });
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('skips a line that is already provisioned (idempotency marker present)', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(completedSale);
    // The idempotency check finds an existing lead_membership for this line.
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({ id: 'lm_x' });

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 0, skipped: 1, failed: 0 });
    }
    // No re-provisioning attempted.
    expect(mockDb.insert).not.toHaveBeenCalled();
    expect(mockDb.query.membershipPlan.findFirst).not.toHaveBeenCalled();
  });

  it('provisions a still-missing membership line and persists the saleItemId marker', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce(completedSale);
    // Idempotency check: not yet provisioned.
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);
    // Reads performed inside the real purchaseMembership (one_time -> no Stripe).
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(oneTimePlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'lm_new', saleItemId: 'item_1', status: 'active' },
    ]);

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 1, skipped: 0, failed: 0 });
    }
    // The inserted membership carries the sale line back-reference that makes
    // subsequent retries idempotent, plus the correct active status/sessions.
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        saleItemId: 'item_1',
        leadId: 'lead_123',
        planId: 'plan_1',
        status: 'active',
        sessionsRemaining: 10,
        stripeSubscriptionId: null,
      })
    );
    expect(
      mockStripeConnectService.createConnectedSubscription
    ).not.toHaveBeenCalled();
  });

  it('persists the Stripe subscription id for a recurring membership line', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      items: [
        {
          id: 'item_rec',
          itemType: 'membership',
          membershipPlanId: 'plan_rec',
        },
      ],
    });
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);
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
    const periodEnd = new Date('2026-08-06T00:00:00Z');
    mockStripeConnectService.createConnectedSubscription.mockResolvedValueOnce({
      subscriptionId: 'sub_1',
      status: 'active',
      currentPeriodEnd: periodEnd,
    });
    mockDb.returning.mockResolvedValueOnce([
      { id: 'lm_rec', stripeSubscriptionId: 'sub_1' },
    ]);

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 1, skipped: 0, failed: 0 });
    }
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeSubscriptionId: 'sub_1',
        validUntil: periodEnd,
        saleItemId: 'item_rec',
      })
    );
  });

  it('counts a line as failed (not fatal) when re-provisioning errors', async () => {
    mockDb.query.sale.findFirst.mockResolvedValueOnce({
      ...completedSale,
      items: [
        {
          id: 'item_rec',
          itemType: 'membership',
          membershipPlanId: 'plan_rec',
        },
      ],
    });
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(recurringPlan);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(mockLead);
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce(
      activeIntegration
    );
    // Stripe blows up -> purchaseMembership returns INTERNAL_ERROR ->
    // retry records the line as failed but the overall run still succeeds.
    mockStripeConnectService.createRecurringPrice.mockRejectedValueOnce(
      new Error('Stripe down')
    );

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ provisioned: 0, skipped: 0, failed: 1 });
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the sale lookup throws', async () => {
    mockDb.query.sale.findFirst.mockRejectedValueOnce(new Error('DB failed'));

    const result = await retryMembershipProvision(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for empty input and does not read the DB', async () => {
    const result = await retryMembershipProvision(mockDb as never, {
      organizationId: '',
      saleId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.sale.findFirst).not.toHaveBeenCalled();
  });
});
