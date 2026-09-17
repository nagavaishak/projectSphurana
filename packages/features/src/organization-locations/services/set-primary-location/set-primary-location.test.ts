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
import { setPrimaryLocation } from './set-primary-location.service.js';

describe('setPrimaryLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'loc-1',
    organizationId: 'org-123',
  };

  const existingLocation = {
    id: 'loc-1',
    organizationId: 'org-123',
    name: 'Main Office',
    addressLine1: '123 Main Street',
    addressLine2: null,
    city: 'Dublin',
    county: null,
    postalCode: null,
    country: 'IE',
    latitude: null,
    longitude: null,
    isPrimary: false,
    sortOrder: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('sets primary location when found', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      existingLocation
    );
    // Only the second update calls .returning()
    mockDb.returning.mockResolvedValueOnce([
      { ...existingLocation, isPrimary: true },
    ]);

    const result = await setPrimaryLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('loc-1');
      expect(result.data.isPrimary).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when location does not exist', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      setPrimaryLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      setPrimaryLocation(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.organizationLocation.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      setPrimaryLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
