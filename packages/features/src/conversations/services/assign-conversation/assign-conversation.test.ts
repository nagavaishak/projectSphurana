import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { assignConversation } from './assign-conversation.service.js';

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('assignConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assigns conversation to agent', async () => {
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'conv-1',
        status: 'agent_handling',
        assignedToId: 'user-1',
      },
    ]);

    const result = await assignConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: 'org-1',
      assignToUserId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('agent_handling');
      expect(result.data.assignedToId).toBe('user-1');
    }
  });

  it('returns NOT_FOUND when conversation missing', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await assignConversation(mockDb as never, {
      id: 'nonexistent',
      organizationId: 'org-1',
      assignToUserId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
