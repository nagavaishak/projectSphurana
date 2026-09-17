import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as queueChatbotFlowModule from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import { updateExistingConversation } from './update-existing-conversation.js';

// The queue cancellers (real ones talk to BullMQ/Redis) are stubbed with
// restored `vi.spyOn`s, NOT `vi.mock`. Under `isolate: false` the worker shares
// one module graph, so a hoisted bare factory both deletes every export it
// omits for later files and silently misses whenever an earlier file already
// imported the real module.
let mockCancelResponseTimeout: MockInstance;
let mockCancelPendingMessageParts: MockInstance;
let mockCancelPendingFollowUp: MockInstance;

const mockDb = {
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
  // Reached by `resolveConversationBranch`, which re-runs when a returning
  // customer clicks a DIFFERENT ad. The default shape is the multi-branch,
  // unresolvable-ad case, so it resolves to null and these tests keep
  // asserting what they asserted before branch resolution existed.
  query: {
    metaAd: { findFirst: vi.fn().mockResolvedValue(undefined) },
    metaCampaignConfig: { findFirst: vi.fn().mockResolvedValue(undefined) },
    organizationLocation: {
      findFirst: vi.fn().mockResolvedValue(undefined),
      findMany: vi.fn().mockResolvedValue([{ id: 'loc-a' }, { id: 'loc-b' }]),
    },
  },
};

const baseConversation = {
  id: 'conv-1',
  organizationId: 'org-1',
  status: 'agent_handling' as const,
  externalUserId: 'sender-1',
  externalUserName: null as string | null,
  platform: 'facebook_messenger' as const,
  metaAdsPageId: null as string | null,
  whatsappAccountId: null as string | null,
  metadata: null,
  lastMessageAt: new Date(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('updateExistingConversation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCancelResponseTimeout = vi
      .spyOn(queueChatbotFlowModule, 'cancelResponseTimeout')
      .mockResolvedValue(undefined as never);
    mockCancelPendingMessageParts = vi
      .spyOn(queueChatbotFlowModule, 'cancelPendingMessageParts')
      .mockResolvedValue(undefined as never);
    mockCancelPendingFollowUp = vi
      .spyOn(queueChatbotFlowModule, 'cancelPendingFollowUp')
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    mockCancelResponseTimeout.mockRestore();
    mockCancelPendingMessageParts.mockRestore();
    mockCancelPendingFollowUp.mockRestore();
  });

  it('never transitions agent_handling to bot_handling', async () => {
    const conv = { ...baseConversation, status: 'agent_handling' as const };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: true,
        metaAdsPageId: null,
        whatsappAccountId: null,
      }
    );

    expect(result.status).toBe('agent_handling');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('keeps bot_handling status when chatbot still active', async () => {
    const conv = {
      ...baseConversation,
      status: 'bot_handling' as const,
    };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: true,
        metaAdsPageId: null,
        whatsappAccountId: null,
      }
    );

    expect(result.status).toBe('bot_handling');
  });

  it('deactivates bot when chatbot not active and status is bot_handling', async () => {
    const conv = {
      ...baseConversation,
      status: 'bot_handling' as const,
    };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: null,
        whatsappAccountId: null,
      }
    );

    expect(result.status).toBe('agent_handling');
  });

  it('cancels pending queue jobs when deactivating bot', async () => {
    const conv = {
      ...baseConversation,
      status: 'bot_handling' as const,
    };

    await updateExistingConversation(mockDb as never, conv as never, {
      isChatbotActive: false,
      metaAdsPageId: null,
      whatsappAccountId: null,
    });

    expect(mockCancelResponseTimeout).toHaveBeenCalledWith('conv-1');
    expect(mockCancelPendingMessageParts).toHaveBeenCalledWith('conv-1');
    expect(mockCancelPendingFollowUp).toHaveBeenCalledWith('conv-1');
  });

  it('backfills sender name when missing on existing conversation', async () => {
    const conv = { ...baseConversation, externalUserName: null };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: null,
        whatsappAccountId: null,
        senderName: 'John Doe',
      }
    );

    expect(result.externalUserName).toBe('John Doe');
    expect((result.metadata as Record<string, unknown>)?.name).toBe('John Doe');
  });

  it('does NOT overwrite existing sender name', async () => {
    const conv = { ...baseConversation, externalUserName: 'Existing Name' };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: null,
        whatsappAccountId: null,
        senderName: 'New Name',
      }
    );

    expect(result.externalUserName).toBe('Existing Name');
  });

  it('updates ad referral metadata on existing conversation', async () => {
    const conv = { ...baseConversation, metadata: {} };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: null,
        whatsappAccountId: null,
        adReferral: {
          adMetaId: 'meta-ad-123',
          adTitle: 'Summer Sale',
          adInternalId: 'internal-1',
        },
      }
    );

    const metadata = result.metadata as Record<string, unknown>;
    expect(metadata.adMetaId).toBe('meta-ad-123');
    expect(metadata.adTitle).toBe('Summer Sale');
    expect(metadata.adInternalId).toBe('internal-1');
  });

  it('does NOT update referral when same ad already set', async () => {
    const conv = {
      ...baseConversation,
      metadata: { adMetaId: 'meta-ad-123', adTitle: 'Old Title' },
    };

    // Reset mock call count before the call we're testing
    mockDb.update.mockClear();

    await updateExistingConversation(mockDb as never, conv as never, {
      isChatbotActive: false,
      metaAdsPageId: null,
      whatsappAccountId: null,
      adReferral: {
        adMetaId: 'meta-ad-123',
        adTitle: 'Summer Sale',
      },
    });

    // update should NOT be called for ad referral since adMetaId matches
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('does NOT update referral when none provided', async () => {
    const conv = { ...baseConversation };

    mockDb.update.mockClear();

    await updateExistingConversation(mockDb as never, conv as never, {
      isChatbotActive: false,
      metaAdsPageId: null,
      whatsappAccountId: null,
    });

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns conversation unchanged when no updates needed', async () => {
    const conv = {
      ...baseConversation,
      externalUserName: 'Existing',
      metaAdsPageId: 'page-1',
    };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: 'page-1',
        whatsappAccountId: null,
      }
    );

    // No DB updates should have been made
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(result.id).toBe('conv-1');
  });

  it('backfills metaAdsPageId when missing', async () => {
    const conv = { ...baseConversation, metaAdsPageId: null };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: 'page-1',
        whatsappAccountId: null,
      }
    );

    expect(result.metaAdsPageId).toBe('page-1');
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('backfills whatsappAccountId when missing', async () => {
    const conv = { ...baseConversation, whatsappAccountId: null };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: null,
        whatsappAccountId: 'wa-1',
      }
    );

    expect(result.whatsappAccountId).toBe('wa-1');
  });

  // ENG-846: `conversation` is unique on (org, externalUserId, platform) —
  // the page is NOT part of that identity. If an org disconnects and
  // reconnects the same Meta page, the reconnection mints a NEW
  // `meta_ads_page` row and the conversation's old pin becomes stale — its
  // token + this conversation's PSID no longer agree, producing Meta (#100)
  // "No matching user found" (subcode 2018001) on every send. The inbound
  // webhook always carries the CURRENT page, so it must re-point the pin
  // rather than leave the old one in place.
  it('re-points a stale metaAdsPageId when the inbound context carries a different page', async () => {
    const conv = { ...baseConversation, metaAdsPageId: 'existing-page' };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: 'new-page',
        whatsappAccountId: null,
      }
    );

    expect(result.metaAdsPageId).toBe('new-page');
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ metaAdsPageId: 'new-page' })
    );
  });

  it('does not touch metaAdsPageId when the inbound context matches the existing pin', async () => {
    const conv = { ...baseConversation, metaAdsPageId: 'existing-page' };

    const result = await updateExistingConversation(
      mockDb as never,
      conv as never,
      {
        isChatbotActive: false,
        metaAdsPageId: 'existing-page',
        whatsappAccountId: null,
      }
    );

    expect(result.metaAdsPageId).toBe('existing-page');
    expect(mockDb.update).not.toHaveBeenCalled();
  });
});
