import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { listConversations } from './list-conversations.service.js';

const mockDb = {
  query: {
    assistantConversation: { findMany: vi.fn() },
  },
};

const validInput = {
  organizationId: 'org-1',
  userId: 'user-1',
};

const mockConversations = [
  {
    id: 'conv-1',
    title: 'First Conversation',
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'conv-2',
    title: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe('listConversations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conversations for valid input', async () => {
    mockDb.query.assistantConversation.findMany.mockResolvedValueOnce(
      mockConversations
    );

    const result = await listConversations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversations).toHaveLength(2);
      expect(result.data.conversations[0].id).toBe('conv-1');
      expect(result.data.conversations[1].title).toBeNull();
    }
  });

  it('returns empty array when no conversations exist', async () => {
    mockDb.query.assistantConversation.findMany.mockResolvedValueOnce([]);

    const result = await listConversations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.conversations).toHaveLength(0);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await listConversations(mockDb as never, {
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.assistantConversation.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await listConversations(mockDb as never, {
      organizationId: 'org-1',
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.assistantConversation.findMany).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.assistantConversation.findMany.mockRejectedValueOnce(
      new Error('DB connection lost')
    );

    const result = await listConversations(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
