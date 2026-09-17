import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { addPractitionerLocations } from './add-practitioner-locations.service.js';

/**
 * Adding a branch to someone who already works elsewhere in the org.
 *
 * The stakes are higher than for the catalogue: a practitioner's branches
 * decide where their appointments can be booked, so the endpoint must be unable
 * to REMOVE one — that is the whole reason it exists beside the replacing PUT.
 */
describe('addPractitionerLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = {
    practitionerId: 'prac-1',
    organizationId: 'org-1',
    locationIds: ['loc-2'],
  };

  const arrange = (current: { locationId: string }[]) => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-2' },
    ] as never);
    mockDb.where.mockResolvedValueOnce(current as never);
  };

  it('adds the branch and removes nothing', async () => {
    arrange([{ locationId: 'loc-1' }]);

    const result = await addPractitionerLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationIds).toEqual(['loc-1', 'loc-2']);
    }
    expect(mockDb.values).toHaveBeenCalledWith([
      { practitionerId: 'prac-1', locationId: 'loc-2' },
    ]);
    // The property that protects a booked-out week at the other branch.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('does NOT narrow someone who works at every branch', async () => {
    arrange([]);

    const result = await addPractitionerLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when they already work there', async () => {
    arrange([{ locationId: 'loc-2' }]);

    const result = await addPractitionerLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a branch belonging to another organization', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce({
      id: 'prac-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await addPractitionerLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a practitioner outside the org', async () => {
    mockDb.query.practitioner.findFirst.mockResolvedValueOnce(null as never);

    const result = await addPractitionerLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('rejects an empty branch list', async () => {
    const result = await addPractitionerLocations(mockDb as never, {
      ...input,
      locationIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
