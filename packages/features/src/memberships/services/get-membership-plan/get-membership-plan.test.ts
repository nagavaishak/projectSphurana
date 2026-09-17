import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getMembershipPlan } from './get-membership-plan.service.js';

describe('getMembershipPlan', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', planId: 'plan_123' };

  it('returns the plan with service ids', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan_123',
      organizationId: 'org_123',
      name: 'Gold',
      services: [
        { id: 'mps_1', planId: 'plan_123', serviceId: 'svc_1' },
        { id: 'mps_2', planId: 'plan_123', serviceId: 'svc_2' },
      ],
    });

    const result = await getMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceIds).toEqual(['svc_1', 'svc_2']);
      expect(
        (result.data as unknown as { services?: unknown }).services
      ).toBeUndefined();
    }
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null);

    const result = await getMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing planId', async () => {
    const result = await getMembershipPlan(mockDb as never, {
      organizationId: 'org_123',
      planId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.membershipPlan.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await getMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
