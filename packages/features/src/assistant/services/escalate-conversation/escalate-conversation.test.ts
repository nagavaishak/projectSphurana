import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { escalateConversation } from './escalate-conversation.service.js';

const mockDb = {
  update: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  conversationId: 'conv-1',
  organizationId: 'org-1',
  userId: 'user-1',
};

describe('escalateConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.update.mockReturnValue(mockDb);
    mockDb.set.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
  });

  it('escalates conversation with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'conv-1', status: 'escalated' },
    ]);

    const result = await escalateConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('escalated');
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('auto-fills reason when none provided', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'conv-1', status: 'escalated' },
    ]);

    await escalateConversation(mockDb as never, validInput);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ escalationReason: 'user_requested' })
    );
  });

  it('uses provided reason when set', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'conv-1', status: 'escalated' },
    ]);

    await escalateConversation(mockDb as never, {
      ...validInput,
      reason: 'pom_question',
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ escalationReason: 'pom_question' })
    );
  });

  it('returns NOT_FOUND when conversation does not exist or is not owned', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await escalateConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing conversationId', async () => {
    const result = await escalateConversation(mockDb as never, {
      ...validInput,
      conversationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await escalateConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
