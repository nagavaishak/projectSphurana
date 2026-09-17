import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { findActiveRecommendationByKind } from './find-active-recommendation-by-kind.service.js';

const mockDb = {
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
  limit: vi.fn(),
};

const validInput = {
  organizationId: 'org-1',
  kind: 'content_no_post_14_days' as const,
};

describe('findActiveRecommendationByKind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('returns existing active row when found (dedup hit)', async () => {
    const row = { id: 'rec-1', kind: 'content_no_post_14_days' };
    mockDb.limit.mockResolvedValueOnce([row]);

    const result = await findActiveRecommendationByKind(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data?.id).toBe('rec-1');
    }
  });

  it('returns null when no active row exists (dedup miss — trigger may proceed)', async () => {
    mockDb.limit.mockResolvedValueOnce([]);

    const result = await findActiveRecommendationByKind(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeNull();
    }
  });

  it('returns VALIDATION_ERROR for invalid kind', async () => {
    const result = await findActiveRecommendationByKind(mockDb as never, {
      organizationId: 'org-1',
      // @ts-expect-error deliberately invalid kind
      kind: 'not_a_real_kind',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.limit.mockRejectedValueOnce(new Error('DB failed'));

    const result = await findActiveRecommendationByKind(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
