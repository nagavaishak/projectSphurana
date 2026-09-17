import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { removeMembershipPlanLocation } from './remove-membership-plan-location.service.js';

/**
 * Taking ONE branch off a membership plan.
 *
 * Both hard cases are here because both fail SILENTLY if written naively:
 * a membership plan with no rows is sold everywhere (so there is no row to delete
 * and doing nothing leaves it in place), and emptying the table reads as
 * "everywhere" — the opposite of a withdrawal.
 */
describe('removeMembershipPlanLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = {
    planId: 'plan-1',
    locationId: 'loc-1',
    organizationId: 'org-1',
  };

  /** Owns the record; the org has three branches; `current` is the join set. */
  const arrange = (current: { locationId: string }[]) => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
      { id: 'loc-2' },
      { id: 'loc-3' },
    ] as never);
    mockDb.where.mockResolvedValueOnce(current as never);
  };

  it('removes the branch and leaves the others', async () => {
    arrange([{ locationId: 'loc-1' }, { locationId: 'loc-2' }]);

    const result = await removeMembershipPlanLocation(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locationIds).toEqual(['loc-2']);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('MATERIALISES the complement when it was sold everywhere', async () => {
    // No rows = every branch. There is nothing to delete, so the only way to
    // say "everywhere except loc-1" is to write the other branches down.
    arrange([]);

    const result = await removeMembershipPlanLocation(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationIds).toEqual(['loc-2', 'loc-3']);
    }
    expect(mockDb.values).toHaveBeenCalledWith([
      { planId: 'plan-1', locationId: 'loc-2' },
      { planId: 'plan-1', locationId: 'loc-3' },
    ]);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('REFUSES to remove the last branch', async () => {
    // Zero rows would read as "every branch" — re-publishing the very thing
    // the operator asked to withdraw.
    arrange([{ locationId: 'loc-1' }]);

    const result = await removeMembershipPlanLocation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/deactivate/i);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a record outside the org', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null as never);

    const result = await removeMembershipPlanLocation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });
});
