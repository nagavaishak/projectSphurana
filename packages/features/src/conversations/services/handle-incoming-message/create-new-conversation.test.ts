import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as createConversationLeadModule from './create-conversation-lead.js';
import { createNewConversation } from './create-new-conversation.js';
import * as fetchSenderProfileModule from './fetch-sender-profile.js';

const mockGetConversationMessages = vi.mocked(
  mockMetaMessagingService.getConversationMessages
);

// Mock fetch for Instagram API calls
vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

// Lead creation and sender-profile fetches are stubbed with restored
// `vi.spyOn`s, NOT `vi.mock`. `packages/features` runs `isolate: false`, so a
// hoisted bare factory both persists on the shared module graph (deleting every
// export it omits for later files) and silently misses whenever an earlier file
// already imported the real module.
//
// The old `vi.mock` of
// `chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js` was
// dropped outright: `create-new-conversation.ts` imports none of those queue
// functions, so the stub was never driven.
let mockCreateLead: MockInstance;
let mockFetchSenderName: MockInstance;
let mockFetchInstagramSenderName: MockInstance;

const mockDb = {
  query: {
    conversationMessage: { findFirst: vi.fn() },
    // Reached by `resolveConversationBranch`. The default shape is the
    // MULTI-branch, no-ad case, which resolves to null — i.e. these tests keep
    // asserting exactly what they asserted before branch resolution existed.
    metaAd: { findFirst: vi.fn().mockResolvedValue(undefined) },
    metaCampaignConfig: { findFirst: vi.fn().mockResolvedValue(undefined) },
    organizationLocation: {
      findFirst: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([{ id: 'loc-a' }, { id: 'loc-b' }]),
    },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

const baseInput = {
  organizationId: 'org-1',
  externalUserId: 'sender-1',
  platform: 'facebook_messenger' as const,
  isChatbotActive: false,
  metaAdsPageId: null as string | null,
  whatsappAccountId: null as string | null,
  page: null as {
    pageAccessToken: string | null;
    pageId: string;
    metaAdsIntegrationId: string;
  } | null,
};

describe('createNewConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateLead = vi
      .spyOn(createConversationLeadModule, 'linkOrCreateConversationLead')
      .mockResolvedValue(undefined as never);
    mockFetchSenderName = vi
      .spyOn(fetchSenderProfileModule, 'fetchSenderName')
      .mockResolvedValue(undefined as never);
    mockFetchInstagramSenderName = vi
      .spyOn(fetchSenderProfileModule, 'fetchInstagramSenderName')
      .mockResolvedValue(undefined as never);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
    vi.mocked(mockMetaMessagingService.getUserProfile).mockResolvedValue({});
    mockGetConversationMessages.mockResolvedValue([]);
    mockDb.returning.mockResolvedValue([
      {
        id: 'conv-1',
        status: 'agent_handling',
        organizationId: 'org-1',
        platform: 'facebook_messenger',
      },
    ]);
  });

  afterEach(() => {
    mockCreateLead.mockRestore();
    mockFetchSenderName.mockRestore();
    mockFetchInstagramSenderName.mockRestore();
  });

  it('creates conversation with bot_handling status when chatbot active', async () => {
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        platform: 'facebook_messenger',
      },
    ]);

    const result = await createNewConversation(mockDb as never, {
      ...baseInput,
      isChatbotActive: true,
    });

    expect(result.status).toBe('bot_handling');
  });

  it('creates conversation with agent_handling status when chatbot not active', async () => {
    const result = await createNewConversation(mockDb as never, {
      ...baseInput,
      isChatbotActive: false,
    });

    expect(result.status).toBe('agent_handling');
  });

  it('sets sender name from input', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      senderName: 'John Doe',
    });

    // Should update conversation with sender name
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        externalUserName: 'John Doe',
      })
    );
  });

  it('fetches sender profile when name not provided (Messenger)', async () => {
    mockFetchSenderName.mockResolvedValueOnce('Fetched Name');

    await createNewConversation(mockDb as never, {
      ...baseInput,
      externalUserId: '123456',
      page: {
        pageAccessToken: 'encrypted-token',
        pageId: 'page-1',
        metaAdsIntegrationId: 'integration-1',
      },
    });

    expect(mockFetchSenderName).toHaveBeenCalledWith(
      expect.objectContaining({ pageId: 'page-1' }),
      '123456',
      'facebook_messenger'
    );
  });

  it('fetches Instagram sender name for standalone Instagram', async () => {
    mockFetchInstagramSenderName.mockResolvedValueOnce('IG User');

    await createNewConversation(mockDb as never, {
      ...baseInput,
      externalUserId: '123456',
      platform: 'instagram_dm',
      page: {
        pageAccessToken: 'encrypted-token',
        pageId: 'ig-page-1',
        metaAdsIntegrationId: '', // standalone Instagram
      },
    });

    expect(mockFetchInstagramSenderName).toHaveBeenCalledWith(
      'encrypted-token',
      '123456'
    );
  });

  it('skips profile fetch for non-numeric sender IDs (e.g. E2E synthetic)', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      externalUserId: 'e2e-sender-123',
      page: {
        pageAccessToken: 'encrypted-token',
        pageId: 'page-1',
        metaAdsIntegrationId: 'integration-1',
      },
    });

    expect(mockFetchSenderName).not.toHaveBeenCalled();
    expect(mockFetchInstagramSenderName).not.toHaveBeenCalled();
  });

  it('stores ad referral metadata on new conversation', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      adReferral: {
        adMetaId: 'meta-ad-123',
        adTitle: 'Summer Sale',
        adInternalId: 'internal-1',
      },
    });

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          adMetaId: 'meta-ad-123',
          adTitle: 'Summer Sale',
          adInternalId: 'internal-1',
        }),
      })
    );
  });

  it('creates lead for new conversation', async () => {
    await createNewConversation(mockDb as never, baseInput);

    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'sender-1',
      undefined,
      'facebook_messenger',
      // conversationId — lets a near-simultaneous handoff dedup against the
      // lead_created notification.
      expect.any(String)
    );
  });

  it('stores the linked leadId in conversation metadata', async () => {
    mockCreateLead.mockResolvedValueOnce('lead-xyz');

    await createNewConversation(mockDb as never, baseInput);

    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ leadId: 'lead-xyz' }),
      })
    );
  });

  it('does not create duplicate lead (delegates to linkOrCreateConversationLead)', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      senderName: 'John',
    });

    expect(mockCreateLead).toHaveBeenCalledWith(
      expect.anything(),
      'org-1',
      'sender-1',
      'John',
      'facebook_messenger',
      expect.any(String)
    );
  });

  it('handles missing page gracefully (no history backfill)', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      page: null,
    });

    expect(mockGetConversationMessages).not.toHaveBeenCalled();
  });

  it('skips history backfill for standalone Instagram', async () => {
    await createNewConversation(mockDb as never, {
      ...baseInput,
      platform: 'instagram_dm',
      page: {
        pageAccessToken: 'encrypted-token',
        pageId: 'ig-page-1',
        metaAdsIntegrationId: '', // standalone Instagram
      },
    });

    expect(mockGetConversationMessages).not.toHaveBeenCalled();
  });

  it('backfills non-text history with derived content + metadata (not blank)', async () => {
    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'h-image',
        message: '',
        from: { id: 'other-user' },
        created_time: new Date().toISOString(),
        attachments: {
          data: [
            {
              mime_type: 'image/jpeg',
              image_data: { url: 'https://cdn/a.jpg' },
            },
          ],
        },
      },
      {
        id: 'h-sticker',
        message: '',
        from: { id: 'other-user' },
        created_time: new Date().toISOString(),
        sticker: 'https://cdn/s.png',
      },
    ] as never);

    await createNewConversation(mockDb as never, {
      ...baseInput,
      // Backfill only runs for numeric PSIDs on non-standalone Messenger/IG.
      externalUserId: '123456',
      page: {
        pageAccessToken: 'encrypted-token',
        pageId: 'page-1',
        metaAdsIntegrationId: 'integration-1',
      },
    });

    const backfilled = mockDb.values.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((v) => v.origin === 'backfill');

    expect(backfilled).toHaveLength(2);
    expect(backfilled).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          content: '📷 Photo',
          messageType: 'image',
          metadata: {
            attachments: [{ type: 'image', url: 'https://cdn/a.jpg' }],
          },
        }),
        expect.objectContaining({
          content: '[Sticker]',
          messageType: 'attachment',
          metadata: { stickerUrl: 'https://cdn/s.png' },
        }),
      ])
    );
    // No blank content ever persisted.
    for (const v of backfilled) {
      expect(String(v.content).trim().length).toBeGreaterThan(0);
    }
  });

  it('does not update DB when no sender name and no ad referral', async () => {
    mockDb.update.mockClear();

    await createNewConversation(mockDb as never, {
      ...baseInput,
      page: null,
    });

    // update is only called for metadata — not for conversation insert
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
