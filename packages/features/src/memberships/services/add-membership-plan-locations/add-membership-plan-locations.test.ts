import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { addMembershipPlanLocations } from './add-membership-plan-locations.service.js';

/**
 * The write behind "import from another location" for membership plans.
 *
 * The two behaviours worth pinning are the ones that differ from the REPLACING
 * `assign…Locations`: a membership plan sold everywhere must not be narrowed to one
 * branch, and a re-sent import must not fail.
 */
describe('addMembershipPlanLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = {
    planId: 'plan-1',
    organizationId: 'org-1',
    locationIds: ['loc-2'],
  };

  /** Owns the record, and `loc-2` is one of the org's branches. */
  const arrange = (current: { locationId: string }[]) => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-2' },
    ] as never);
    // The existing links are read through `addLocationLinks`, which selects.
    mockDb.where.mockResolvedValueOnce(current as never);
  };

  it('adds the branch, leaving the existing assignments alone', async () => {
    arrange([{ locationId: 'loc-1' }]);

    const result = await addMembershipPlanLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationIds).toEqual(['loc-1', 'loc-2']);
    }
    expect(mockDb.values).toHaveBeenCalledWith([
      { planId: 'plan-1', locationId: 'loc-2' },
    ]);
    // Nothing is removed — the whole difference from the PUT.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('does NOT narrow a membership plan that is sold everywhere', async () => {
    // Zero rows means "every branch". Inserting one would take this away from
    // every OTHER branch — an import causing an outage.
    arrange([]);

    const result = await addMembershipPlanLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the branch already has it', async () => {
    arrange([{ locationId: 'loc-2' }]);

    const result = await addMembershipPlanLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a branch belonging to another organization', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce({
      id: 'plan-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await addMembershipPlanLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a record outside the org', async () => {
    mockDb.query.membershipPlan.findFirst.mockResolvedValueOnce(null as never);

    const result = await addMembershipPlanLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('rejects an empty branch list', async () => {
    const result = await addMembershipPlanLocations(mockDb as never, {
      ...input,
      locationIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
