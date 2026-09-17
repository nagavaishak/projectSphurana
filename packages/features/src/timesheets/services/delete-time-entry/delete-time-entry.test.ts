import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteTimeEntry } from './delete-time-entry.service.js';

describe('deleteTimeEntry', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = { organizationId: 'org_123', timeEntryId: 'te_1' };

  it('deletes an existing entry', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'te_1' }]);

    const result = await deleteTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ success: true });
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing ids', async () => {
    const result = await deleteTimeEntry(mockDb as never, {
      organizationId: 'org_123',
      timeEntryId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when nothing was deleted', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deleteTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns INTERNAL_ERROR on db failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await deleteTimeEntry(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
