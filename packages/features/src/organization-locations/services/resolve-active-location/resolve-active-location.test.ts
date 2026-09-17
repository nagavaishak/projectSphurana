import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { resolveActiveLocation } from './resolve-active-location.service.js';

/**
 * This resolver is the whole security value of the `X-Location-Id` header: the
 * id is client-supplied, so "does this branch belong to the caller's org" is a
 * tenant check, not a lookup. The org predicate living in the WHERE clause is
 * therefore the thing under test, alongside the deliberate choice to answer
 * NOT_FOUND rather than FORBIDDEN so the endpoint is not an id oracle.
 */
describe('resolveActiveLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('resolves a location that belongs to the organization', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-1',
      organizationId: 'org-123',
      name: 'Dublin',
      isPrimary: true,
    });

    const result = await resolveActiveLocation(mockDb as never, {
      organizationId: 'org-123',
      locationId: 'loc-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('loc-1');
      expect(result.data.organizationId).toBe('org-123');
    }
  });

  it('returns NOT_FOUND — not FORBIDDEN — when the row is another org’s', async () => {
    // The org predicate is in the query, so a foreign location simply does not
    // come back. NOT_FOUND is the deliberate answer: "exists but not yours" and
    // "does not exist" must be indistinguishable to the caller.
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      resolveActiveLocation(mockDb as never, {
        organizationId: 'org-123',
        locationId: 'loc-belonging-to-org-456',
      })
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a blank location id without querying', async () => {
    await expectResult(
      resolveActiveLocation(mockDb as never, {
        organizationId: 'org-123',
        locationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for a blank organization id without querying', async () => {
    await expectResult(
      resolveActiveLocation(mockDb as never, {
        organizationId: '',
        locationId: 'loc-1',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.query.organizationLocation.findFirst).not.toHaveBeenCalled();
  });
});
