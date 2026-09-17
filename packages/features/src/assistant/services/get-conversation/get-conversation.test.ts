import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { getConversation } from './get-conversation.service.js';

const mockDb = {
  query: {
    assistantConversation: { findFirst: vi.fn() },
    assistantMessage: { findMany: vi.fn() },
  },
};

const validInput = {
  id: 'conv-1',
  organizationId: 'org-1',
  userId: 'user-1',
};

const mockConversation = {
  id: 'conv-1',
  title: 'Test Conversation',
  status: 'active' as const,
  escalatedAt: null,
  escalationReason: null,
  loadedSkillIds: [],
  skillRegistryVersion: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockMessages = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    toolCalls: null,
    toolResults: null,
    attachments: null,
    createdAt: new Date(),
  },
  {
    id: 'msg-2',
    role: 'assistant',
    content: 'Hi there!',
    toolCalls: null,
    toolResults: null,
    attachments: null,
    createdAt: new Date(),
  },
];

describe('getConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns conversation with messages when found', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce(
      mockConversation
    );
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce(mockMessages);

    const result = await getConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('conv-1');
      expect(result.data.title).toBe('Test Conversation');
      expect(result.data.messages).toHaveLength(2);
      expect(result.data.messages[0].role).toBe('user');
      expect(result.data.messages[1].role).toBe('assistant');
    }
  });

  it('returns NOT_FOUND when conversation does not exist', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce(null);

    const result = await getConversation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
    expect(mockDb.query.assistantMessage.findMany).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing id', async () => {
    const result = await getConversation(mockDb as never, {
      id: '',
      organizationId: 'org-1',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.assistantConversation.findFirst).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await getConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for missing userId', async () => {
    const result = await getConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: 'org-1',
      userId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns conversation with empty messages array', async () => {
    mockDb.query.assistantConversation.findFirst.mockResolvedValueOnce(
      mockConversation
    );
    mockDb.query.assistantMessage.findMany.mockResolvedValueOnce([]);

    const result = await getConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.messages).toHaveLength(0);
    }
  });
});
