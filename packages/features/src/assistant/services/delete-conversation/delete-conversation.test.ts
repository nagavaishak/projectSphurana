import { isFeatureOn } from '@borradh-workspace/observability';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { deleteConversation } from './delete-conversation.service.js';

const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  id: 'conv-1',
  organizationId: 'org-1',
  userId: 'user-1',
};

describe('deleteConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isFeatureOn).mockResolvedValue(true);
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('deletes conversation with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'conv-1' }]);

    const result = await deleteConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith({
      deletedAt: expect.any(Date),
    });
  });

  it('returns NOT_FOUND when conversation does not exist', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await deleteConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    const result = await deleteConversation(mockDb as never, {
      id: '',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await deleteConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await deleteConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: 'org-1',
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await deleteConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
