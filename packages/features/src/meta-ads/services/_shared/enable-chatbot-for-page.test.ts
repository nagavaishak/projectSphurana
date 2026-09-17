import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { enableChatbotForPage } from './enable-chatbot-for-page.js';

const createMockDb = () => ({
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
});

describe('enableChatbotForPage', () => {
  let mockDb: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDb();
  });

  it('sets isChatbotActive to true on the page', async () => {
    const result = await enableChatbotForPage(mockDb as never, {
      metaAdsPageId: 'page-001',
    });

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ isChatbotActive: true })
    );
  });
});
