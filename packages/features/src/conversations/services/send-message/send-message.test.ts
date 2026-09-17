import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { sendMessage } from './send-message.service.js';

const mockSendTextMessage = vi.mocked(mockMetaMessagingService.sendTextMessage);

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    metaAdsPage: { findFirst: vi.fn() },
    instagramIntegration: { findFirst: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

describe('sendMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendTextMessage.mockReset().mockResolvedValue({ messageId: 'msg-x' });
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted-token',
    } as never);
  });

  it('sends agent message successfully', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-1',
      externalUserId: 'ext-1',
      platform: 'facebook_messenger',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'msg-1',
        content: 'Hello!',
        role: 'agent',
        conversationId: 'conv-1',
      },
    ]);

    const result = await sendMessage(mockDb as never, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      content: 'Hello!',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role).toBe('agent');
    }
  });

  it('returns NOT_FOUND when conversation missing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    const result = await sendMessage(mockDb as never, {
      conversationId: 'nonexistent',
      organizationId: 'org-1',
      content: 'Hello!',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  // ENG-846: an Instagram DM conversation can carry a stale non-null
  // `metaAdsPageId` (legacy FK). Branching on it alone — instead of gating on
  // `platform` first — would send an IGSID to graph.facebook.com with a
  // Facebook page token.
  it('routes an Instagram DM through the Instagram integration even when metaAdsPageId is stale', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      id: 'conv-ig',
      externalUserId: 'ig-user-1',
      platform: 'instagram_dm',
      organizationId: 'org-1',
      metaAdsPageId: 'stale-fb-page',
    });
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      organizationId: 'org-1',
      isActive: true,
      encryptedCredentials: 'ig-encrypted',
      instagramUserId: 'ig-page-id',
    });
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'msg-2',
        content: 'Hello IG!',
        role: 'agent',
        conversationId: 'conv-ig',
      },
    ]);

    const result = await sendMessage(mockDb as never, {
      conversationId: 'conv-ig',
      organizationId: 'org-1',
      content: 'Hello IG!',
      userId: 'user-1',
    });

    expect(result.success).toBe(true);
    expect(mockDb.query.metaAdsPage.findFirst).not.toHaveBeenCalled();
    expect(mockDb.query.instagramIntegration.findFirst).toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledWith('ig-user-1', 'Hello IG!');
  });

  it('returns VALIDATION_ERROR for empty content', async () => {
    const result = await sendMessage(mockDb as never, {
      conversationId: 'conv-1',
      organizationId: 'org-1',
      content: '',
      userId: 'user-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
