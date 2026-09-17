import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// Every internal collaborator below is stubbed with a RESTORED `vi.spyOn`
// (see beforeEach/afterEach), never a file-local `vi.mock` factory: this
// package runs `isolate: false`, so a factory would persist on the shared
// worker module graph and leak into every later file — and would silently miss
// if an earlier file had already imported the real module.
import * as queueChatbotFlowModule from '../../../chatbots/services/queue-chatbot-flow/queue-chatbot-flow.service.js';
import * as createConversationLead from './create-conversation-lead.js';
import * as createNewConversationModule from './create-new-conversation.js';
import * as fetchSenderProfile from './fetch-sender-profile.js';
import { handleIncomingMessage } from './handle-incoming-message.service.js';
import * as pendingAdReferral from './pending-ad-referral.js';
import * as recordIncomingMessageModule from './record-incoming-message.js';
import * as resolveAdReferralModule from './resolve-ad-referral.js';
import * as resolveMessageContext from './resolve-message-context.js';
import * as updateExistingConversationModule from './update-existing-conversation.js';

// Shared handle for the Meta messaging history methods. The service calls
// `getConversationMessages` (fetch-sender-profile / create-new-conversation)
// and `getConversationMessagesOrThrow` (handle-incoming-message) on different
// paths — both are wired to this single mock so existing tests keep working.
const mockGetConversationMessages = vi.mocked(
  mockMetaMessagingService.getConversationMessages
);

let mockQueueChatbotFlow: MockInstance;
let mockResolveMessengerContext: MockInstance;
let mockResolveInstagramContext: MockInstance;
let mockResolveWhatsAppChatbot: MockInstance;
let mockCreateNewConversation: MockInstance;
let mockUpdateExistingConversation: MockInstance;
let mockRecordIncomingMessage: MockInstance;
let mockResolveAdReferral: MockInstance;
let mockConsumePendingAdReferral: MockInstance;
let spies: MockInstance[] = [];

function installSpies() {
  mockQueueChatbotFlow = vi
    .spyOn(queueChatbotFlowModule, 'queueChatbotFlow')
    .mockResolvedValue({ success: true } as never);
  mockResolveMessengerContext = vi.spyOn(
    resolveMessageContext,
    'resolveMessengerContext'
  );
  mockResolveInstagramContext = vi.spyOn(
    resolveMessageContext,
    'resolveInstagramContext'
  );
  mockResolveWhatsAppChatbot = vi.spyOn(
    resolveMessageContext,
    'resolveWhatsAppChatbot'
  );
  mockCreateNewConversation = vi.spyOn(
    createNewConversationModule,
    'createNewConversation'
  );
  mockUpdateExistingConversation = vi.spyOn(
    updateExistingConversationModule,
    'updateExistingConversation'
  );
  mockRecordIncomingMessage = vi.spyOn(
    recordIncomingMessageModule,
    'recordIncomingMessage'
  );
  mockResolveAdReferral = vi
    .spyOn(resolveAdReferralModule, 'resolveAdReferral')
    .mockResolvedValue(null as never);
  mockConsumePendingAdReferral = vi
    .spyOn(pendingAdReferral, 'consumePendingAdReferral')
    .mockResolvedValue(null as never);

  spies = [
    mockQueueChatbotFlow,
    mockResolveMessengerContext,
    mockResolveInstagramContext,
    mockResolveWhatsAppChatbot,
    mockCreateNewConversation,
    mockUpdateExistingConversation,
    mockRecordIncomingMessage,
    mockResolveAdReferral,
    mockConsumePendingAdReferral,
    vi
      .spyOn(queueChatbotFlowModule, 'cancelResponseTimeout')
      .mockResolvedValue(undefined),
    vi
      .spyOn(queueChatbotFlowModule, 'cancelPendingMessageParts')
      .mockResolvedValue(undefined),
    vi
      .spyOn(queueChatbotFlowModule, 'cancelPendingFollowUp')
      .mockResolvedValue(undefined),
    vi
      .spyOn(createConversationLead, 'linkOrCreateConversationLead')
      .mockResolvedValue('lead-1' as never),
    vi
      .spyOn(fetchSenderProfile, 'fetchSenderName')
      .mockResolvedValue(undefined as never),
    vi
      .spyOn(fetchSenderProfile, 'fetchInstagramSenderName')
      .mockResolvedValue(undefined as never),
    vi
      .spyOn(pendingAdReferral, 'storePendingAdReferral')
      .mockResolvedValue(undefined),
  ];
}

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
  },
  update: vi.fn().mockReturnThis(),
  set: vi.fn().mockReturnThis(),
  where: vi.fn().mockResolvedValue([]),
};

describe('handleIncomingMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installSpies();
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue([]);
    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'test-token',
    });
    vi.mocked(mockMetaMessagingService.getUserProfile).mockResolvedValue({});
    mockGetConversationMessages.mockResolvedValue([]);
    // Route the *OrThrow variant through the same shared mock so tests that
    // configure `mockGetConversationMessages` cover both code paths.
    vi.mocked(
      mockMetaMessagingService.getConversationMessagesOrThrow
    ).mockImplementation((...args: unknown[]) =>
      mockGetConversationMessages(...args)
    );
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
  });

  describe('facebook_messenger routing', () => {
    it('routes via metaAdsPage.pageId and creates conversation', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce({
        isChatbotActive: true,
        organizationId: 'org-1',
        metaAdsPageId: 'page-internal-1',
        whatsappAccountId: null,
        page: {
          id: 'page-internal-1',
          pageId: 'meta-page-1',
          pageAccessToken: null,
          metaAdsIntegrationId: 'integration-1',
          isChatbotActive: true,
        },
      });

      // No existing conversation
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);

      mockRecordIncomingMessage.mockResolvedValueOnce({
        id: 'msg-1',
        alreadyExists: false,
      });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'user-ext-1',
        messageText: 'Hello',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('conv-1');
        expect(result.data.messageId).toBe('msg-1');
      }
      // Must NOT touch Instagram integrations
      expect(mockResolveInstagramContext).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when page not found', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(null);

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'unknown-page',
        senderId: 'user-ext-1',
        messageText: 'Hello',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      }
      // Must NOT fall through to Instagram integration lookup
      expect(mockResolveInstagramContext).not.toHaveBeenCalled();
    });

    it('creates agent-handled conversation when chatbot not active', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce({
        isChatbotActive: false,
        organizationId: 'org-1',
        metaAdsPageId: 'page-internal-1',
        whatsappAccountId: null,
        page: {
          id: 'page-internal-1',
          pageId: 'meta-page-1',
          pageAccessToken: null,
          metaAdsIntegrationId: 'integration-1',
          isChatbotActive: false,
        },
      });

      // No existing conversation
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-1',
        status: 'agent_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);

      mockRecordIncomingMessage.mockResolvedValueOnce({
        id: 'msg-1',
        alreadyExists: false,
      });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'user-ext-1',
        messageText: 'Hello',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('conv-1');
      }
    });
  });

  describe('instagram_dm routing', () => {
    it('routes via instagramIntegration.instagramUserId', async () => {
      mockResolveInstagramContext.mockResolvedValueOnce({
        isChatbotActive: true,
        organizationId: 'org-1',
        metaAdsPageId: null,
        whatsappAccountId: null,
        page: {
          id: 'ig-int-1',
          pageId: 'igba-123',
          pageAccessToken: 'encrypted-token',
          platform: 'instagram',
          metaAdsIntegrationId: '',
        },
      });

      // No existing conversation
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);

      mockRecordIncomingMessage.mockResolvedValueOnce({
        id: 'msg-1',
        alreadyExists: false,
      });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'igba-123',
        senderId: 'user-ext-1',
        messageText: 'Hello',
        platform: 'instagram_dm',
      });

      expect(result.success).toBe(true);
      // Must NOT touch metaAdsPage
      expect(mockResolveMessengerContext).not.toHaveBeenCalled();
    });

    it('returns NOT_FOUND when no Instagram integration matches', async () => {
      mockResolveInstagramContext.mockResolvedValueOnce(null);

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'unknown-igba',
        senderId: 'user-ext-1',
        messageText: 'Hello',
        platform: 'instagram_dm',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      }
      // Must NOT fall through to metaAdsPage
      expect(mockResolveMessengerContext).not.toHaveBeenCalled();
    });
  });

  describe('platform isolation', () => {
    it('facebook_messenger never queries instagramIntegration', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(null);

      await handleIncomingMessage(mockDb as never, {
        pageId: 'some-page',
        senderId: 'user-1',
        messageText: 'Hello',
        platform: 'facebook_messenger',
      });

      expect(mockResolveInstagramContext).not.toHaveBeenCalled();
    });

    it('instagram_dm never queries metaAdsPage', async () => {
      mockResolveInstagramContext.mockResolvedValueOnce(null);

      await handleIncomingMessage(mockDb as never, {
        pageId: 'some-igba',
        senderId: 'user-1',
        messageText: 'Hello',
        platform: 'instagram_dm',
      });

      expect(mockResolveMessengerContext).not.toHaveBeenCalled();
    });
  });

  // newLeadsOnly / adLeadsOnly targeting was removed. Lead vs.
  // friends-family/returning-client/spam triage is now Claire's semantic
  // MESSAGE CLASSIFICATION (she silently hands non-leads to the owner), so the
  // bot activates whenever the page's chatbot is on — no PSID/ad-history gate.
  describe('no targeting gate', () => {
    const messengerContext = {
      isChatbotActive: true,
      organizationId: 'org-1',
      metaAdsPageId: 'page-1',
      whatsappAccountId: null,
      page: {
        id: 'page-1',
        pageId: 'meta-page-1',
        pageAccessToken: null,
        metaAdsIntegrationId: 'integration-1',
        isChatbotActive: true,
      },
    };

    it('keeps the bot active for a returning contact (no newLeadsOnly suppression)', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);

      const existingConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: 'John',
      };
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(existingConv);
      mockUpdateExistingConversation.mockResolvedValueOnce(existingConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({ id: 'msg-1' });

      await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'existing-user',
        messageText: 'Hello again',
        platform: 'facebook_messenger',
      });

      expect(mockUpdateExistingConversation).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ isChatbotActive: true })
      );
    });

    it('never queries org chatbot settings for targeting', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({ id: 'msg-1' });

      await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'user-1',
        messageText: 'Hello',
        platform: 'facebook_messenger',
      });

      // The targeting-settings lookup was removed entirely.
      expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('empty message handling', () => {
    const messengerContext = {
      isChatbotActive: true,
      organizationId: 'org-1',
      metaAdsPageId: 'page-1',
      whatsappAccountId: null,
      page: {
        id: 'page-1',
        pageId: 'meta-page-1',
        pageAccessToken: null,
        metaAdsIntegrationId: 'integration-1',
        isChatbotActive: true,
      },
    };

    it('does not create new conversation for empty message from unknown sender', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'new-user',
        messageText: '',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('');
        expect(result.data.messageId).toBe('');
      }
      expect(mockCreateNewConversation).not.toHaveBeenCalled();
    });

    it('does not create new conversation for whitespace-only message', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'new-user',
        messageText: '   ',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('');
      }
      expect(mockCreateNewConversation).not.toHaveBeenCalled();
    });

    it('still updates existing conversation for empty message (reaction/sticker)', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);

      const existingConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: 'John',
      };
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(existingConv);
      mockUpdateExistingConversation.mockResolvedValueOnce(existingConv);

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'existing-user',
        messageText: '',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('conv-1');
        expect(result.data.messageId).toBe('');
      }
      // Conversation was updated but no message recorded, no flow queued
      expect(mockUpdateExistingConversation).toHaveBeenCalled();
      expect(mockRecordIncomingMessage).not.toHaveBeenCalled();
    });

    it('records a sticker (no text) on an existing conversation without queueing the bot', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);

      const existingConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: 'John',
      };
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(existingConv);
      mockUpdateExistingConversation.mockResolvedValueOnce(existingConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({ id: 'msg-sticker' });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'existing-user',
        messageId: 'ext-sticker',
        // No text — a bare sticker. Previously skipped entirely (blank/never
        // recorded); must now be recorded with a label + metadata.
        attachments: [{ type: 'image', payload: { sticker_id: 12345 } }],
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.messageId).toBe('msg-sticker');

      expect(mockRecordIncomingMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: '[Sticker]',
          messageType: 'attachment',
          metadata: { stickerId: '12345' },
        })
      );
      // A bare sticker must NOT push an AI text response.
      expect(mockQueueChatbotFlow).not.toHaveBeenCalled();
    });

    it('records a photo and queues the bot when a caption is present', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);

      const existingConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: 'John',
      };
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(existingConv);
      mockUpdateExistingConversation.mockResolvedValueOnce(existingConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({ id: 'msg-photo' });

      await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'existing-user',
        messageId: 'ext-photo',
        messageText: 'what about this?',
        attachments: [{ type: 'image', payload: { url: 'https://cdn/p.jpg' } }],
        platform: 'facebook_messenger',
      });

      expect(mockRecordIncomingMessage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          content: 'what about this?',
          messageType: 'image',
          metadata: {
            attachments: [{ type: 'image', url: 'https://cdn/p.jpg' }],
          },
        })
      );
      // Caption text means the bot should still respond.
      expect(mockQueueChatbotFlow).toHaveBeenCalled();
    });

    it('creates a conversation for a sticker from a brand-new sender', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-new',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({ id: 'msg-1' });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'brand-new',
        messageId: 'ext-1',
        attachments: [{ type: 'image', payload: { url: 'https://cdn/p.jpg' } }],
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      // A photo first-contact is a real message — create the conversation
      // (previously skipped, leaving the contact invisible).
      expect(mockCreateNewConversation).toHaveBeenCalled();
      expect(mockQueueChatbotFlow).not.toHaveBeenCalled();
    });

    it('still processes non-empty message for new sender', async () => {
      mockResolveMessengerContext.mockResolvedValueOnce(messengerContext);
      mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

      const createdConv = {
        id: 'conv-1',
        status: 'bot_handling',
        organizationId: 'org-1',
        externalUserName: null,
      };
      mockCreateNewConversation.mockResolvedValueOnce(createdConv);
      mockRecordIncomingMessage.mockResolvedValueOnce({
        id: 'msg-1',
        alreadyExists: false,
      });

      const result = await handleIncomingMessage(mockDb as never, {
        pageId: 'meta-page-1',
        senderId: 'new-user',
        messageText: 'Hello there',
        platform: 'facebook_messenger',
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.conversationId).toBe('conv-1');
        expect(result.data.messageId).toBe('msg-1');
      }
      expect(mockCreateNewConversation).toHaveBeenCalled();
      expect(mockRecordIncomingMessage).toHaveBeenCalled();
    });
  });
});
