import { mockStripeService } from '@borradh-workspace/integrations/stripe';
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
import { seedSubscription } from './seed-subscription.service.js';

const getSubscription = vi.mocked(mockStripeService.getSubscription);
const getSubscriptionByCustomer = vi.mocked(
  mockStripeService.getSubscriptionByCustomer
);

describe('seedSubscription', () => {
  const mockDb = createMockDatabase();

  const subscription = {
    id: 'sub_123',
    status: 'active' as const,
    customerId: 'cus_123',
    priceId: 'price_pro',
    currentPeriodStart: new Date('2026-08-01T00:00:00Z'),
    currentPeriodEnd: new Date('2026-09-01T00:00:00Z'),
    cancelAtPeriodEnd: false,
    canceledAt: null,
    endedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    getSubscription.mockReset();
    getSubscriptionByCustomer.mockReset();

    mockDb.query.subscriptions.findFirst.mockResolvedValue(null);
    mockDb.query.creditBalances.findFirst.mockResolvedValue(null);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: 'Glow' });
    mockDb.query.member.findFirst.mockResolvedValue(null);
    mockDb.insert.mockReturnThis();
    mockDb.values.mockResolvedValue(undefined);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);
  });

  it('seeds from a subscription id', async () => {
    getSubscription.mockResolvedValueOnce(subscription);

    const result = await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'sub_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stripeSubscriptionId).toBe('sub_123');
      expect(result.data.stripeCustomerId).toBe('cus_123');
    }
    expect(getSubscriptionByCustomer).not.toHaveBeenCalled();
  });

  it('resolves a customer id to their subscription', async () => {
    getSubscriptionByCustomer.mockResolvedValueOnce(subscription);

    const result = await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'cus_123',
    });

    expect(result.success).toBe(true);
    expect(getSubscriptionByCustomer).toHaveBeenCalledWith('cus_123');
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it('grants the opening credit balance, like Checkout does', async () => {
    // The failure this catches: a seeded org looks subscribed everywhere and
    // then cannot send a single message, with nothing in the UI to explain it.
    getSubscription.mockResolvedValueOnce(subscription);

    await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'sub_123',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-123',
        balance: 100000,
        includedCredits: 100000,
      })
    );
  });

  it('does not re-grant credits when a balance already exists', async () => {
    getSubscription.mockResolvedValueOnce(subscription);
    mockDb.query.creditBalances.findFirst.mockResolvedValueOnce({
      id: 'bal-1',
      balance: 42,
    });

    await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'sub_123',
    });

    const creditWrites = mockDb.values.mock.calls.filter(
      (call) => (call[0] as Record<string, unknown>).includedCredits
    );
    expect(creditWrites).toHaveLength(0);
  });

  it('carries the real Stripe status and period across', async () => {
    getSubscription.mockResolvedValueOnce({
      ...subscription,
      status: 'trialing' as const,
    });

    await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'sub_123',
    });

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'trialing',
        stripePriceId: 'price_pro',
        currentPeriodEnd: subscription.currentPeriodEnd,
      })
    );
  });

  it('refuses a subscription already seeded on another organization', async () => {
    getSubscription.mockResolvedValueOnce(subscription);
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      id: 'sub-row',
      organizationId: 'org-999',
      stripeSubscriptionId: 'sub_123',
    });

    await expectResult(
      seedSubscription(mockDb as never, {
        organizationId: 'org-123',
        stripeRef: 'sub_123',
      })
    ).toFailWithCode(ErrorCodes.CONFLICT);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows re-seeding the SAME organization', async () => {
    getSubscription.mockResolvedValueOnce(subscription);
    mockDb.query.subscriptions.findFirst.mockResolvedValue({
      id: 'sub-row',
      organizationId: 'org-123',
      stripeSubscriptionId: 'sub_123',
    });

    const result = await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'sub_123',
    });

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it.each([['canceled'], ['unpaid'], ['incomplete_expired']])(
    'refuses a %s subscription rather than lighting the product up',
    async (status) => {
      getSubscription.mockResolvedValueOnce({
        ...subscription,
        status: status as never,
      });

      await expectResult(
        seedSubscription(mockDb as never, {
          organizationId: 'org-123',
          stripeRef: 'sub_123',
        })
      ).toFailWithCode(ErrorCodes.CONFLICT);
      expect(mockDb.insert).not.toHaveBeenCalled();
    }
  );

  it('returns NOT_FOUND when the customer has no subscription', async () => {
    getSubscriptionByCustomer.mockResolvedValueOnce(null);

    const result = await seedSubscription(mockDb as never, {
      organizationId: 'org-123',
      stripeRef: 'cus_123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toMatch(/no subscription/i);
    }
  });

  it.each([
    ['a Connect account id', 'acct_1A2b3C'],
    ['a price id', 'price_123'],
    ['an empty string', ''],
  ])('rejects %s before calling Stripe', async (_label, stripeRef) => {
    await expectResult(
      seedSubscription(mockDb as never, {
        organizationId: 'org-123',
        stripeRef,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(getSubscription).not.toHaveBeenCalled();
    expect(getSubscriptionByCustomer).not.toHaveBeenCalled();
  });

  it('returns EXTERNAL_SERVICE_ERROR when Stripe is unreachable', async () => {
    getSubscription.mockRejectedValueOnce(new Error('socket hang up'));

    await expectResult(
      seedSubscription(mockDb as never, {
        organizationId: 'org-123',
        stripeRef: 'sub_123',
      })
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });
});
