import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { markRecommendationActioned } from './mark-recommendation-actioned.service.js';

const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  recommendationId: 'rec-1',
  organizationId: 'org-1',
};

describe('markRecommendationActioned', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('marks recommendation actioned with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'rec-1' }]);

    const result = await markRecommendationActioned(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'actioned' })
    );
  });

  it('sets actionedAt timestamp', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'rec-1' }]);

    await markRecommendationActioned(mockDb as never, validInput);

    const callArg = mockDb.set.mock.calls[0]?.[0];
    expect(callArg.actionedAt).toBeInstanceOf(Date);
  });

  it('returns NOT_FOUND when recommendation is missing', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await markRecommendationActioned(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await markRecommendationActioned(mockDb as never, {
      ...validInput,
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await markRecommendationActioned(
      mockDb as never,
      validInput
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
