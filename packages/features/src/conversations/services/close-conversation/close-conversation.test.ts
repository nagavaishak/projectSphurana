import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { closeConversation } from './close-conversation.service.js';

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('closeConversation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('closes conversation successfully', async () => {
    mockDb.returning.mockResolvedValueOnce([
      { id: 'conv-1', status: 'closed' },
    ]);

    const result = await closeConversation(mockDb as never, {
      id: 'conv-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('closed');
    }
  });

  it('returns NOT_FOUND when conversation missing', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await closeConversation(mockDb as never, {
      id: 'nonexistent',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });
});
