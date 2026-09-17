import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteMembershipPlan } from './delete-membership-plan.service.js';

describe('deleteMembershipPlan', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', planId: 'plan_123' };
  const existingPlan = { id: 'plan_123', organizationId: 'org_123' };

  it('hard-deletes a plan that was never sold', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(existingPlan);
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce(null);

    const result = await deleteMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ deleted: true, deactivated: false });
    }
    expect(mockDb.delete).toHaveBeenCalledTimes(1);
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('deactivates a plan with sold memberships', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(existingPlan);
    mockDb.query.leadMembership.findFirst.mockResolvedValueOnce({
      id: 'lm_1',
      planId: 'plan_123',
    });

    const result = await deleteMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ deleted: false, deactivated: true });
    }
    expect(mockDb.update).toHaveBeenCalledTimes(1);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the plan does not exist', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null);

    const result = await deleteMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.membershipPlan.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    const result = await deleteMembershipPlan(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
