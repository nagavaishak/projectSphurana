import { drizzleUniqueViolation } from '@borradh-workspace/database';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateMembershipPlan } from './update-membership-plan.service.js';

describe('updateMembershipPlan', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const existingPlan = {
    id: 'plan_123',
    organizationId: 'org_123',
    name: 'Gold',
    pricingType: 'recurring',
    validFor: '1m',
    priceCents: 10000,
    currency: 'eur',
    stripeProductId: 'prod_1',
    stripePriceId: 'price_1',
    isActive: true,
  };

  it('returns NOT_FOUND when the plan does not exist', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null);

    const result = await updateMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: 'plan_missing',
      name: 'New name',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('updates fields and replaces services', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(existingPlan);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingPlan, name: 'Platinum' },
    ]);

    const result = await updateMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: 'plan_123',
      name: 'Platinum',
      serviceIds: ['svc_9'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Platinum');
      expect(result.data.serviceIds).toEqual(['svc_9']);
    }
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('clears stripePriceId when the price changes', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(existingPlan);
    mockDb.returning.mockResolvedValueOnce([
      { ...existingPlan, priceCents: 12000, stripePriceId: null },
    ]);
    mockDb.query.membershipPlanService.findMany.mockResolvedValueOnce([]);

    const result = await updateMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: 'plan_123',
      priceCents: 12000,
    });

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ priceCents: 12000, stripePriceId: null })
    );
  });

  it('returns ALREADY_EXISTS on duplicate name', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(existingPlan);
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('membership_plan_org_name_unique')
    );

    const result = await updateMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: 'plan_123',
      name: 'Taken',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.membershipPlan.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await updateMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: 'plan_123',
      name: 'X',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
