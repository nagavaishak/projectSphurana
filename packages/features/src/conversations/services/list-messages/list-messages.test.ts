import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listMessages } from './list-messages.service.js';

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    conversationMessage: { findMany: vi.fn().mockResolvedValue([]) },
  },
};

describe('listMessages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns messages for conversation', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
    });
    const mockMessages = [
      { id: 'msg-1', content: 'Hello', role: 'user' },
      { id: 'msg-2', content: 'Hi there!', role: 'bot' },
    ];
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce(
      mockMessages
    );

    const result = await listMessages(mockDb as never, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
    }
  });

  it('returns NOT_FOUND when conversation missing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await listMessages(mockDb as never, {
      conversationId: 'nonexistent',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
