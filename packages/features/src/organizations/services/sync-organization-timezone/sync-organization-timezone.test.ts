import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { syncOrganizationTimezone } from './sync-organization-timezone.service.js';

const ORG = 'org_123';

/** Redlands, California — the org that surfaced the incident. */
const REDLANDS = { latitude: 34.068844, longitude: -117.140015, country: 'us' };

describe('syncOrganizationTimezone', () => {
  const findOrg = vi.fn();
  const findLocation = vi.fn();
  const set = vi.fn();
  const where = vi.fn();

  const mockDb = {
    query: {
      organization: { findFirst: findOrg },
      organizationLocation: { findFirst: findLocation },
    },
    update: vi.fn(() => ({ set })),
  } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    set.mockReturnValue({ where });
    where.mockResolvedValue(undefined);
  });

  it('writes the derived timezone for an org still on the UTC default', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'UTC' });
    findLocation.mockResolvedValueOnce(REDLANDS);

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        timezone: 'America/Los_Angeles',
        changed: true,
        reason: 'written',
      });
    }
    expect(set).toHaveBeenCalledWith({ timezone: 'America/Los_Angeles' });
  });

  // The guard that makes this safe to call on every location write.
  it('leaves an already-set timezone alone', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'Europe/Dublin' });

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.changed).toBe(false);
      expect(result.data.reason).toBe('already-set');
      expect(result.data.timezone).toBe('Europe/Dublin');
    }
    expect(set).not.toHaveBeenCalled();
    // It must not even look at the location — nothing to decide.
    expect(findLocation).not.toHaveBeenCalled();
  });

  it('overwrites an already-set timezone when forced', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'Europe/Dublin' });
    findLocation.mockResolvedValueOnce(REDLANDS);

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
      force: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.changed).toBe(true);
    expect(set).toHaveBeenCalledWith({ timezone: 'America/Los_Angeles' });
  });

  it('writes nothing when the org has no location', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'UTC' });
    findLocation.mockResolvedValueOnce(undefined);

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        timezone: 'UTC',
        changed: false,
        reason: 'no-location',
      });
    }
    expect(set).not.toHaveBeenCalled();
  });

  // Never invent a value: an unresolvable location leaves the column untouched
  // so the org stays visible to the unresolved-timezone audit.
  it('writes nothing when the location cannot be resolved', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'UTC' });
    findLocation.mockResolvedValueOnce({
      latitude: null,
      longitude: null,
      country: null,
    });

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.reason).toBe('unresolvable');
    expect(set).not.toHaveBeenCalled();
  });

  // A forced sync that resolves to the value already stored — e.g. a country
  // edit that does not actually move the business between zones. Reachable only
  // under `force`, since without it the already-set guard returns first.
  it('does not write when a forced sync derives the value already stored', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'America/Los_Angeles' });
    findLocation.mockResolvedValueOnce(REDLANDS);

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
      force: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe('unchanged');
      expect(result.data.changed).toBe(false);
    }
    expect(set).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a missing organization', async () => {
    findOrg.mockResolvedValueOnce(undefined);

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: 'nope',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for an empty organizationId', async () => {
    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR when the write fails', async () => {
    findOrg.mockResolvedValueOnce({ id: ORG, timezone: 'UTC' });
    findLocation.mockResolvedValueOnce(REDLANDS);
    where.mockRejectedValueOnce(new Error('db down'));

    const result = await syncOrganizationTimezone(mockDb, {
      organizationId: ORG,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
