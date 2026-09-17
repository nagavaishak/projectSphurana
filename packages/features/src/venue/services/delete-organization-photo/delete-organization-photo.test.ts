import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteOrganizationPhoto } from './delete-organization-photo.service.js';

describe('deleteOrganizationPhoto', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('hard-deletes the photo on the happy path', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'photo-1' }]);

    const result = await deleteOrganizationPhoto(mockDb as never, {
      id: 'photo-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('photo-1');
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns NOT_FOUND when no row matches the id + org', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deleteOrganizationPhoto(mockDb as never, {
      id: 'foreign',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for a missing id', async () => {
    const result = await deleteOrganizationPhoto(mockDb as never, {
      id: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
