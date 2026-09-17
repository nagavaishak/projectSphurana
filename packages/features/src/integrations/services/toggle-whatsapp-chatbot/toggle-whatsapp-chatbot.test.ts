import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { toggleWhatsAppChatbot } from './toggle-whatsapp-chatbot.service.js';

const mockDb = {
  query: {
    whatsappAccount: {
      findFirst: vi.fn(),
    },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue(undefined),
};

describe('toggleWhatsAppChatbot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('enables chatbot for an existing account', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
    });

    const result = await toggleWhatsAppChatbot(mockDb as never, {
      organizationId: 'org-1',
      accountId: 'wa-1',
      enabled: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isChatbotActive).toBe(true);
    }
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('disables chatbot for an existing account', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce({
      id: 'wa-1',
      organizationId: 'org-1',
    });

    const result = await toggleWhatsAppChatbot(mockDb as never, {
      organizationId: 'org-1',
      accountId: 'wa-1',
      enabled: false,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isChatbotActive).toBe(false);
    }
  });

  it('returns NOT_FOUND when account does not exist', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    const result = await toggleWhatsAppChatbot(mockDb as never, {
      organizationId: 'org-1',
      accountId: 'nonexistent',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns VALIDATION_ERROR for missing accountId', async () => {
    const result = await toggleWhatsAppChatbot(mockDb as never, {
      organizationId: 'org-1',
      accountId: '',
      enabled: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
