import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { setCoverPhoto } from './set-cover-photo.service.js';

describe('setCoverPhoto', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it("sets the target cover and clears the flag on the venue's other photos", async () => {
    // First update (mark target cover) resolves to the target row.
    mockDb.returning.mockResolvedValueOnce([{ id: 'photo-1' }]);
    mockDb.query.organizationPhoto.findMany.mockResolvedValueOnce([
      { id: 'photo-1', isCover: true },
      { id: 'photo-2', isCover: false },
    ]);

    const result = await setCoverPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      photoId: 'photo-1',
    });

    expect(result.success).toBe(true);
    // Two updates: set target true, then clear the others.
    expect(mockDb.update).toHaveBeenCalledTimes(2);
    expect(mockDb.set).toHaveBeenCalledWith({ isCover: true });
    expect(mockDb.set).toHaveBeenCalledWith({ isCover: false });
  });

  it('returns VALIDATION_ERROR for a missing photoId', async () => {
    const result = await setCoverPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      photoId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when the target photo is not in the org', async () => {
    // No row returned from the first update.
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await setCoverPhoto(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      photoId: 'foreign',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    // The clear-others update must NOT run when the target was not found.
    expect(mockDb.update).toHaveBeenCalledTimes(1);
  });
});
