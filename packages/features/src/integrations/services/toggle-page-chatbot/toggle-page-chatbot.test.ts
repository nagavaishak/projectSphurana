import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { togglePageChatbot } from './toggle-page-chatbot.service.js';

const mockDb = {
  query: {
    metaAdsPage: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

describe('togglePageChatbot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables chatbot for an existing page', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      integration: { organizationId: 'org-1' },
    });

    const result = await togglePageChatbot(mockDb as never, {
      organizationId: 'org-1',
      pageId: 'page-1',
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isChatbotActive).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('disables chatbot for an existing page', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'page-1',
      integration: { organizationId: 'org-1' },
    });

    const result = await togglePageChatbot(mockDb as never, {
      organizationId: 'org-1',
      pageId: 'page-1',
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isChatbotActive).toBe(false);
    }
  });

  it('returns NOT_FOUND when page does not exist', async () => {
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(null);

    const result = await togglePageChatbot(mockDb as never, {
      organizationId: 'org-1',
      pageId: 'nonexistent',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing pageId', async () => {
    const result = await togglePageChatbot(mockDb as never, {
      organizationId: 'org-1',
      pageId: '',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
