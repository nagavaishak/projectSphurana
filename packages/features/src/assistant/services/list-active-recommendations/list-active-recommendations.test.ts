import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { listActiveRecommendations } from './list-active-recommendations.service.js';

const mockDb = {
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  orderBy: vi.fn(),
};

describe('listActiveRecommendations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('returns active recommendations ordered by priority then age', async () => {
    const rows = [
      { id: 'r1', priority: 10 },
      { id: 'r2', priority: 0 },
    ];
    mockDb.orderBy.mockResolvedValueOnce(rows);

    const result = await listActiveRecommendations(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].id).toBe('r1');
    }
  });

  it('returns empty array when nothing active', async () => {
    mockDb.orderBy.mockResolvedValueOnce([]);

    const result = await listActiveRecommendations(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listActiveRecommendations(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.orderBy.mockRejectedValueOnce(new Error('DB failed'));

    const result = await listActiveRecommendations(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
