import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { createConversation } from './create-conversation.service.js';

const mockDb = {
  insert: vi.fn(),
  values: vi.fn(),
  returning: vi.fn(),
};

const validInput = {
  organizationId: 'org-1',
  userId: 'user-1',
  title: 'Test Conversation',
};

describe('createConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.insert.mockReturnValue(mockDb);
    mockDb.values.mockReturnValue(mockDb);
  });

  it('creates conversation with valid input', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'conv-1' }]);

    const result = await createConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('conv-1');
    }
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('creates conversation without optional title', async () => {
    mockDb.returning.mockResolvedValueOnce([{ id: 'conv-2' }]);

    const result = await createConversation(mockDb as never, {
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('conv-2');
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await createConversation(mockDb as never, {
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await createConversation(mockDb as never, {
      organizationId: 'org-1',
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for title exceeding max length', async () => {
    const result = await createConversation(mockDb as never, {
      organizationId: 'org-1',
      userId: 'user-1',
      title: 'a'.repeat(101),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.returning.mockRejectedValueOnce(new Error('DB connection lost'));

    const result = await createConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
