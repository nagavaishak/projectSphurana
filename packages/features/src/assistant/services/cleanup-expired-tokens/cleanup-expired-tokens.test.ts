import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { cleanupExpiredTokens } from './cleanup-expired-tokens.service.js';

const mockDb = {
  delete: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

describe('cleanupExpiredTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.delete.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('returns the count of rows deleted', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 't1' },
      { id: 't2' },
      { id: 't3' },
    ]);

    const result = await cleanupExpiredTokens(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(3);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('returns 0 when nothing to clean up', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await cleanupExpiredTokens(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deleted).toBe(0);
    }
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await cleanupExpiredTokens(mockDb as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
