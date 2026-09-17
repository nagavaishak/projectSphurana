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
import { createMembershipPlan } from './create-membership-plan.service.js';

describe('createMembershipPlan', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
    name: 'Gold Membership',
    priceCents: 10000,
    serviceIds: ['svc_1', 'svc_2'],
  };

  const mockPlan = {
    id: 'plan_123',
    organizationId: 'org_123',
    name: 'Gold Membership',
    pricingType: 'one_time',
    validFor: '1m',
    priceCents: 10000,
    sessionCount: null,
  };

  it('creates a plan and links services', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPlan]);

    const result = await createMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Gold Membership');
      expect(result.data.serviceIds).toEqual(['svc_1', 'svc_2']);
    }
    // plan insert + join insert
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('creates a plan without service join rows when serviceIds empty', async () => {
    mockDb.returning.mockResolvedValueOnce([mockPlan]);

    const result = await createMembershipPlan(mockDb as never, {
      ...validInput,
      serviceIds: [],
    });

    expect(result.success).toBe(true);
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('returns VALIDATION_ERROR for non-positive price', async () => {
    const result = await createMembershipPlan(mockDb as never, {
      ...validInput,
      priceCents: 0,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a recurring plan whose interval exceeds the Stripe 3-year cap', async () => {
    const result = await createMembershipPlan(mockDb as never, {
      ...validInput,
      pricingType: 'recurring' as const,
      validFor: '5y' as const,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('allows a recurring plan within the Stripe 3-year cap', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { ...mockPlan, pricingType: 'recurring', validFor: '1y' },
    ]);

    const result = await createMembershipPlan(mockDb as never, {
      ...validInput,
      pricingType: 'recurring' as const,
      validFor: '1y' as const,
    });

    expect(result.success).toBe(true);
  });

  it('returns ALREADY_EXISTS on duplicate name', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('membership_plan_org_name_unique')
    );

    const result = await createMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
