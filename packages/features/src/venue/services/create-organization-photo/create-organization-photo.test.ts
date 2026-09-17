import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createOrganizationPhoto } from './create-organization-photo.service.js';

describe('createOrganizationPhoto', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('creates a photo on the happy path', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-1',
    });
    const photo = {
      id: 'photo-1',
      organizationId: 'org-1',
      locationId: 'loc-1',
      url: 'https://cdn/1.jpg',
      caption: 'Reception',
      sortOrder: 0,
      isCover: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    mockDb.returning.mockResolvedValueOnce([photo]);

    const result = await createOrganizationPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      url: 'https://cdn/1.jpg',
      caption: 'Reception',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('photo-1');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when url is missing', async () => {
    const result = await createOrganizationPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      url: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the location is not in the org', async () => {
    // organizationLocation.findFirst defaults to null (no such location).
    const result = await createOrganizationPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'foreign',
      url: 'https://cdn/1.jpg',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-1',
    });
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await createOrganizationPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      url: 'https://cdn/1.jpg',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
