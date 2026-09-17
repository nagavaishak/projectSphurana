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
import { updateLocation } from './update-location.service.js';

describe('updateLocation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    vi.mocked(geocodeAddress).mockResolvedValue(null);
  });

  const validInput = {
    id: 'loc-1',
    organizationId: 'org-123',
    name: 'Updated Office',
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
    isPrimary: false,
    sortOrder: 0,
    latitude: null,
    longitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('updates location with valid input', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      existingLocation
    );
    mockDb.returning.mockResolvedValueOnce([
      { ...existingLocation, name: 'Updated Office' },
    ]);

    const result = await updateLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('loc-1');
      expect(result.data.name).toBe('Updated Office');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when location does not exist', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      updateLocation(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.organizationLocation.findFirst.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      updateLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
