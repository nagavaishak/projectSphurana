import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { handleMembershipSubscriptionWebhook } from './handle-membership-subscription-webhook.service.js';

describe('handleMembershipSubscriptionWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const membership = {
    id: 'lm_123',
    organizationId: 'org_123',
    stripeSubscriptionId: 'sub_1',
    status: 'active',
  };

  it('ignores unknown subscriptions', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);

    const result = await handleMembershipSubscriptionWebhook(mockDb as never, {
      eventType: 'customer.subscription.updated',
      stripeSubscriptionId: 'sub_unknown',
      stripeStatus: 'active',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        processed: false,
        leadMembershipId: null,
        action: 'ignored',
      });
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('maps past_due and updates validUntil', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(membership);
    const periodEnd = new Date('2026-08-06T00:00:00Z');

    const result = await handleMembershipSubscriptionWebhook(mockDb as never, {
      eventType: 'customer.subscription.updated',
      stripeSubscriptionId: 'sub_1',
      stripeStatus: 'past_due',
      currentPeriodEnd: periodEnd,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.action).toBe('updated');
      expect(result.data.leadMembershipId).toBe('lm_123');
    }
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'past_due', validUntil: periodEnd })
    );
  });

  it('marks the membership cancelled on subscription.deleted', async () => {
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(membership);

    const result = await handleMembershipSubscriptionWebhook(mockDb as never, {
      eventType: 'customer.subscription.deleted',
      stripeSubscriptionId: 'sub_1',
      stripeStatus: 'canceled',
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'cancelled' })
    );
  });

  it('returns VALIDATION_ERROR for an unsupported event type', async () => {
    const result = await handleMembershipSubscriptionWebhook(mockDb as never, {
      eventType: 'customer.subscription.created' as never,
      stripeSubscriptionId: 'sub_1',
      stripeStatus: 'active',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.leadMembership.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await handleMembershipSubscriptionWebhook(mockDb as never, {
      eventType: 'customer.subscription.updated',
      stripeSubscriptionId: 'sub_1',
      stripeStatus: 'active',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
