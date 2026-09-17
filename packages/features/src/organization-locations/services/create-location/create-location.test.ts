import { geocodeAddress } from '@borradh-workspace/integrations';
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
import { createLocation } from './create-location.service.js';

// `@borradh-workspace/labels` is aliased to its real (pure-constants) source in
// vite.config.ts — no file-local mock needed (it would leak under
// `isolate: false`). The real `countryCodeValues` are ISO-3166 lowercase codes
// (`ie`, `gb`, `us`, …) — the values the production schema validates against —
// so this suite uses `'ie'` rather than the previously-mocked uppercase `'IE'`.

describe('createLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(geocodeAddress).mockResolvedValue(null);
  });

  const validInput = {
    organizationId: 'org-123',
    addressLine1: '123 Main Street',
    city: 'Dublin',
    country: 'ie' as const,
  };

  const mockLocation = {
    id: 'loc-1',
    organizationId: 'org-123',
    name: null,
    addressLine1: '123 Main Street',
    addressLine2: null,
    city: 'Dublin',
    county: null,
    postalCode: null,
    country: 'ie',
    isPrimary: false,
    sortOrder: 0,
    latitude: null,
    longitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('creates location with valid input', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockResolvedValueOnce([mockLocation]);

    const result = await createLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.addressLine1).toBe('123 Main Street');
      expect(result.data.city).toBe('Dublin');
      expect(result.data.country).toBe('ie');
    }
  });

  it('creates location with isPrimary=true and unsets existing primaries', async () => {
    // findMany for sort order
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { sortOrder: 2 },
    ]);
    mockDb.returning.mockResolvedValueOnce([
      { ...mockLocation, isPrimary: true, sortOrder: 3 },
    ]);

    const result = await createLocation(mockDb as never, {
      ...validInput,
      isPrimary: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isPrimary).toBe(true);
    }
    // update called to unset existing primaries
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing addressLine1', async () => {
    await expectResult(
      createLocation(mockDb as never, { ...validInput, addressLine1: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing city', async () => {
    await expectResult(
      createLocation(mockDb as never, { ...validInput, city: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for invalid country code', async () => {
    await expectResult(
      createLocation(mockDb as never, {
        ...validInput,
        country: 'INVALID' as never,
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      createLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
