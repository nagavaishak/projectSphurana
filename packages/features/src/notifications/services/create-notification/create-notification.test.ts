import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { createNotification } from './create-notification.service.js';

const mockDb = {
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

const validInput = {
  organizationId: 'org-1',
  userId: 'u1',
  type: 'ad_rejected' as const,
  title: 'Ad rejected',
  body: 'Your ad was rejected',
};

describe('createNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
  });

  it('persists an in-app notification row', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'n1', ...validInput }]);

    const result = await createNotification(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.id).toBe('n1');
  });

  it('returns VALIDATION_ERROR for an empty title', async () => {
    const result = await createNotification(mockDb as never, {
      ...validInput,
      title: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the insert fails', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB down'));

    const result = await createNotification(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
