import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listMembershipPlans } from './list-membership-plans.service.js';

describe('listMembershipPlans', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('lists plans with service ids', async () => {
    mockDb.query.membershipPlan.findMany.mockResolvedValueOnce([
      {
        id: 'plan_1',
        name: 'Gold',
        services: [{ id: 'mps_1', planId: 'plan_1', serviceId: 'svc_1' }],
      },
      { id: 'plan_2', name: 'Silver', services: [] },
    ]);

    const result = await listMembershipPlans(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].serviceIds).toEqual(['svc_1']);
      expect(result.data[1].serviceIds).toEqual([]);
    }
  });

  it('accepts an isActive filter', async () => {
    mockDb.query.membershipPlan.findMany.mockResolvedValueOnce([]);

    const result = await listMembershipPlans(mockDb as never, {
      organizationId: 'org_123',
      isActive: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual([]);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listMembershipPlans(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.membershipPlan.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await listMembershipPlans(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
