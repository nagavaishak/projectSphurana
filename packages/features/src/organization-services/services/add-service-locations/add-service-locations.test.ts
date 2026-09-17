import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { addServiceLocations } from './add-service-locations.service.js';

/**
 * The write behind "import from another location".
 *
 * Two behaviours here are not conveniences — they are the reasons this exists
 * as a separate endpoint from the REPLACING `assignServiceLocations`:
 * a service offered everywhere must not be narrowed, and a re-sent import must
 * not fail.
 */
describe('addServiceLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const input = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    locationIds: ['loc-2'],
  };

  /** Owns the service, and `loc-2` is one of the org's branches. */
  const arrange = (current: { locationId: string }[]) => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
    } as never);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-2' },
    ] as never);
    // The current links are read through `addLocationLinks`, which selects
    // rather than using the relational query API.
    mockDb.where.mockResolvedValueOnce(current as never);
  };

  it('adds the branch, leaving the existing assignments alone', async () => {
    arrange([{ locationId: 'loc-1' }]);

    const result = await addServiceLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationIds).toEqual(['loc-1', 'loc-2']);
    }
    expect(mockDb.values).toHaveBeenCalledWith([
      {
        serviceId: 'svc-1',
        locationId: 'loc-2',
        priceCentsOverride: null,
        durationMinutesOverride: null,
      },
    ]);
    // Nothing is removed — that is the whole difference from the PUT.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('does NOT narrow a service that is offered everywhere', async () => {
    // Zero rows means "every branch". Inserting one would take this service
    // away from every OTHER branch — an import causing an outage.
    arrange([]);

    const result = await addServiceLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('is a no-op when the branch already offers it', async () => {
    arrange([{ locationId: 'loc-2' }]);

    const result = await addServiceLocations(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a branch belonging to another organization', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc-1',
    } as never);
    // The org owns no branch with that id.
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await addServiceLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a service outside the org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      null as never
    );

    const result = await addServiceLocations(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('rejects an empty branch list', async () => {
    const result = await addServiceLocations(mockDb as never, {
      ...input,
      locationIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
