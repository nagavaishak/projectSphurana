import { MetaApiError } from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';

import { ErrorCodes } from '../../../shared/index.js';
import { syncConversationMessages } from './sync-conversation-messages.service.js';

// The service uses the throwing variant `getConversationMessagesOrThrow` so a
// MetaApiError (dead token / archived conversation) propagates into the catch
// that marks needs_reconnect / closes the conversation. Drive that method here.
const mockGetConversationMessages = vi.mocked(
  mockMetaMessagingService.getConversationMessagesOrThrow
);

// The service now:
// 1. Skips conversations with non-numeric externalUserId
// 2. Uses determineSyncRole() which queries conversationMessage.findFirst for page messages
// 3. Uses .onConflictDoNothing() chain on insert
// 4. Uses isNull() instead of eq('', ...)
// 5. Does a fire-and-forget backfill update for content-matched messages
const mockDb = {
  query: {
    conversation: { findMany: vi.fn() },
    conversationMessage: { findMany: vi.fn(), findFirst: vi.fn() },
    metaAdsPage: { findFirst: vi.fn() },
    metaAdsIntegration: { findFirst: vi.fn() },
    instagramIntegration: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  onConflictDoNothing: vi.fn().mockReturnThis(),
  returning: vi.fn(),
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  catch: vi.fn(),
};

const validInput = {
  organizationId: 'org-123',
};

describe('syncConversationMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
    mockDb.insert.mockReturnThis();
    mockDb.values.mockReturnThis();
    mockDb.onConflictDoNothing.mockReturnThis();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockReturnThis();
    mockGetConversationMessages.mockResolvedValue([]);
    // Default: determineSyncRole returns null (no match -> defaults to 'agent')
    mockDb.query.conversationMessage.findFirst.mockResolvedValue(null);
    // Default: the parent Meta Ads integration token is healthy, so
    // buildMessenger's needs_reconnect short-circuit (Fix D) does not skip it.
    mockDb.query.metaAdsIntegration.findFirst.mockResolvedValue({
      tokenStatus: 'valid',
    });
  });

  it('returns synced: 0 when no conversations found', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([]);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(0);
      expect(result.data.errors).toBe(0);
    }
  });

  it('syncs new messages from Meta for a conversation with metaAdsPage', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890', // numeric - won't be skipped
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'ext-msg-1',
        message: 'Hello',
        created_time: '2024-01-01T00:00:00Z',
        from: { id: '1234567890' },
      },
      {
        id: 'ext-msg-2',
        message: 'Reply from page',
        created_time: '2024-01-01T00:01:00Z',
        from: { id: '9876543210' },
      },
    ]);

    // No existing messages
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);
    // determineSyncRole for the page message (ext-msg-2) -> no local match
    mockDb.query.conversationMessage.findFirst.mockResolvedValueOnce(null);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(2);
      expect(result.data.errors).toBe(0);
    }
    // Should have inserted 2 messages
    expect(mockDb.insert).toHaveBeenCalledTimes(2);
  });

  it('deduplicates messages already in the database', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'ext-msg-1',
        message: 'Hello',
        created_time: '2024-01-01T00:00:00Z',
        from: { id: '1234567890' },
      },
      {
        id: 'ext-msg-2',
        message: 'Already exists',
        created_time: '2024-01-01T00:01:00Z',
        from: { id: '9876543210' },
      },
    ]);

    // ext-msg-2 already exists
    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([
      { externalMessageId: 'ext-msg-2' },
    ]);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(1);
    }
    // Only 1 new message inserted
    expect(mockDb.insert).toHaveBeenCalledTimes(1);
  });

  it('skips conversations where no messenger can be built', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: null, // no meta ads page
      },
    ]);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(0);
      expect(result.data.errors).toBe(0);
    }
    expect(mockGetConversationMessages).not.toHaveBeenCalled();
  });

  it('skips conversations with empty message history', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockResolvedValueOnce([]);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(0);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('sets role to user for messages from external user', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'ext-msg-1',
        message: 'User message',
        created_time: '2024-01-01T00:00:00Z',
        from: { id: '1234567890' }, // not the page
      },
    ]);

    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

    await syncConversationMessages(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user' })
    );
  });

  it('sets role based on determineSyncRole for messages from the page', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'ext-msg-1',
        message: 'Page message',
        created_time: '2024-01-01T00:00:00Z',
        from: { id: '9876543210' }, // the page itself
      },
    ]);

    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);
    // determineSyncRole finds a local bot message match
    mockDb.query.conversationMessage.findFirst.mockResolvedValueOnce({
      role: 'bot',
    });

    await syncConversationMessages(mockDb as never, validInput);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'bot' })
    );
  });

  it('counts errors for individual conversation failures without failing overall', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockRejectedValueOnce(
      new Error('Meta API rate limit')
    );

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(0);
      expect(result.data.errors).toBe(1);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await syncConversationMessages(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns INTERNAL_ERROR on top-level DB failure', async () => {
    mockDb.query.conversation.findMany.mockRejectedValueOnce(
      new Error('DB connection failed')
    );

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('builds messenger via Instagram integration for instagram_dm platform', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-ig-1',
        organizationId: 'org-123',
        platform: 'instagram_dm',
        externalUserId: '5555555555', // numeric
        metaAdsPageId: null, // standalone Instagram
      },
    ]);

    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      organizationId: 'org-123',
      isActive: true,
      encryptedCredentials: 'encrypted-creds',
      instagramUserId: '6666666666',
      tokenStatus: 'valid', // healthy: not skipped by Fix D short-circuit
    });

    mockGetConversationMessages.mockResolvedValueOnce([
      {
        id: 'ig-msg-1',
        message: 'IG message',
        created_time: '2024-01-01T00:00:00Z',
        from: { id: '5555555555' },
      },
    ]);

    mockDb.query.conversationMessage.findMany.mockResolvedValueOnce([]);

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(1);
    }
  });

  it('skips metaAdsPage conversation when page has no access token', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-1',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: null, // no token
    });

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.synced).toBe(0);
    }
    expect(mockGetConversationMessages).not.toHaveBeenCalled();
  });

  it('closes conversation and skips when Meta returns subcode 2018365 (archived/deleted)', async () => {
    mockDb.query.conversation.findMany.mockResolvedValueOnce([
      {
        id: 'conv-archived',
        organizationId: 'org-123',
        platform: 'facebook_messenger',
        externalUserId: '1234567890',
        metaAdsPageId: 'ads-page-1',
      },
    ]);

    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      id: 'ads-page-1',
      pageId: '9876543210',
      pageAccessToken: 'encrypted-token',
    });

    mockGetConversationMessages.mockRejectedValueOnce(
      new MetaApiError({
        error: {
          message: 'Conversation has been archived or deleted',
          code: 100,
          error_subcode: 2018365,
        },
      })
    );

    const result = await syncConversationMessages(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      // Archived conversation should NOT count as an error
      expect(result.data.errors).toBe(0);
      expect(result.data.synced).toBe(0);
    }
    // Should have called update() to close the conversation
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'closed' })
    );
  });
});
