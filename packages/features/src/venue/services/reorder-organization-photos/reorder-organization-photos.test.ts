import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { reorderOrganizationPhotos } from './reorder-organization-photos.service.js';

describe('reorderOrganizationPhotos', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('writes one update per id then returns the reordered list', async () => {
    mockDb.query.organizationPhoto.findMany.mockResolvedValueOnce([
      { id: 'photo-2', sortOrder: 0 },
      { id: 'photo-1', sortOrder: 1 },
    ]);

    const result = await reorderOrganizationPhotos(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      orderedIds: ['photo-2', 'photo-1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
    // One update per id in the ordered list.
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(mockDb.set).toHaveBeenCalledWith({ sortOrder: 0 });
    expect(mockDb.set).toHaveBeenCalledWith({ sortOrder: 1 });
  });

  it('returns VALIDATION_ERROR for an empty orderedIds list', async () => {
    const result = await reorderOrganizationPhotos(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      orderedIds: [],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
