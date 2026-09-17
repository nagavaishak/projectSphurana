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
import { listLocations } from './list-locations.service.js';

describe('listLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  const mockLocations = [
    {
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
      isPrimary: true,
      sortOrder: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'loc-2',
      organizationId: 'org-123',
      name: 'Branch',
      addressLine1: '456 Side Road',
      addressLine2: null,
      city: 'Cork',
      county: null,
      postalCode: null,
      country: 'IE',
      latitude: null,
      longitude: null,
      isPrimary: false,
      sortOrder: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ];

  it('returns locations for organization', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      mockLocations
    );

    const result = await listLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.items[0].id).toBe('loc-1');
      expect(result.data.items[1].id).toBe('loc-2');
    }
  });

  it('returns empty list when no locations exist', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);

    const result = await listLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listLocations(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
