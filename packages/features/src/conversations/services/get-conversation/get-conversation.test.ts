import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getConversation } from './get-conversation.service.js';

const mockDb = {
  query: { conversation: { findFirst: vi.fn() } },
};

describe('getConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns conversation when found', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      chatbotId: 'bot-1',
    });

    const result = await getConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
  });

  it('returns NOT_FOUND when missing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await getConversation(mockDb as never, {
      id: 'nonexistent',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
