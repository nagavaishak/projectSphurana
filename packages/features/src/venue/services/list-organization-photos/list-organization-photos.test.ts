import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listOrganizationPhotos } from './list-organization-photos.service.js';

describe('listOrganizationPhotos', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it("returns the location's photos ordered by sortOrder", async () => {
    mockDb.query.organizationPhoto.findMany.mockResolvedValueOnce([
      { id: 'photo-1', sortOrder: 0 },
      { id: 'photo-2', sortOrder: 1 },
    ]);

    const result = await listOrganizationPhotos(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const result = await listOrganizationPhotos(mockDb as never, {
      organizationId: '',
      locationId: 'loc-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
