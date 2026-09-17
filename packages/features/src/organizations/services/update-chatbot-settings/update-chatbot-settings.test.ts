import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { updateChatbotSettings } from './update-chatbot-settings.service.js';

const mockDb = {
  query: {
    organization: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

describe('updateChatbotSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates chatbot settings successfully', async () => {
    const mockOrg = { id: 'org-1' };
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'org-1',
        chatbotSettings: { goal: 'free_consultation', tone: 'friendly' },
        chatbotSystemPrompt: null,
        knowledgeBase: null,
      },
    ]);

    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: 'org-1',
      chatbotSettings: { goal: 'free_consultation', tone: 'friendly' },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotSettings).toEqual({
        goal: 'free_consultation',
        tone: 'friendly',
      });
    }
  });

  it('updates system prompt successfully', async () => {
    const mockOrg = { id: 'org-1' };
    mockDb.query.organization.findFirst.mockResolvedValueOnce(mockOrg);
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'org-1',
        chatbotSettings: null,
        chatbotSystemPrompt: 'You are a helpful assistant.',
        knowledgeBase: null,
      },
    ]);

    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: 'org-1',
      chatbotSystemPrompt: 'You are a helpful assistant.',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.chatbotSystemPrompt).toBe(
        'You are a helpful assistant.'
      );
    }
  });

  it('returns VALIDATION_ERROR when no fields to update', async () => {
    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for empty organizationId', async () => {
    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: '',
      chatbotSystemPrompt: 'test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: 'nonexistent',
      chatbotSystemPrompt: 'test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({ id: 'org-1' });
    mockDb.returning.mockRejectedValueOnce(new Error('DB failed'));

    const result = await updateChatbotSettings(mockDb as never, {
      organizationId: 'org-1',
      chatbotSystemPrompt: 'test',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
