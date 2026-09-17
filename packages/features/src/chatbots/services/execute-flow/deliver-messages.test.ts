import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { mockMetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { mockWhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { createMockDatabase } from '@borradh-workspace/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as sharedAudit from '../../../shared/core/audit.js';

// NOTE: no `vi.mock('@borradh-workspace/integrations')` here. That specifier is
// canonically aliased to src/__mocks__/integrations.ts; under `isolate: false` a
// file-local factory persists on the shared worker module graph. This one
// declared its OWN `MetaApiError` class, which broke `instanceof` for every
// other consumer, and it exported a subset that mutually clobbered
// update-ad.test.ts's (now also removed) factory.
//
// The canonical mock re-exports the REAL `MetaApiError` /
// `extractMetaErrorContext` / `isMetaAuthError` (pure logic over the static Meta
// error registry), so the errors below are built from genuine Meta error
// responses whose registry entries classify them into the categories under test.

// NOTE: the conversation-event audit write is stubbed with a RESTORED
// `vi.spyOn` (see beforeEach/afterEach below), not `vi.mock`. `shared/index.js`
// has a fan-in of ~570 test files and this package runs `isolate: false`, so a
// file-local factory mock of that barrel would persist on the shared worker
// module graph and leak `logConversationEvent: vi.fn()` into every later file.

import { MetaApiError } from '@borradh-workspace/integrations';
import { logError } from '@borradh-workspace/observability';
import { deliverMessages } from './deliver-messages.js';

// Method fns — driven via the canonical stable service instances.
const mockSendTextMessage = vi.mocked(mockMetaMessagingService.sendTextMessage);
const mockSendQuickReply = vi.mocked(mockMetaMessagingService.sendQuickReply);
const mockSendAttachment = vi.mocked(mockMetaMessagingService.sendAttachment);
const mockSendTypingIndicator = vi.mocked(
  mockMetaMessagingService.sendTypingIndicator
);
const mockWaSendTextMessage = vi.mocked(
  mockWhatsAppCloudService.sendTextMessage
);

const metaConv = {
  id: 'conv-1',
  platform: 'facebook_messenger',
  metaAdsPageId: 'page-1',
  whatsappAccountId: null,
  externalUserId: 'ext-user-1',
  organizationId: 'org-1',
  externalUserName: 'Test User',
  metadata: null,
};

const whatsappConv = {
  id: 'conv-2',
  platform: 'whatsapp',
  metaAdsPageId: null,
  whatsappAccountId: 'wa-1',
  externalUserId: 'ext-wa-user',
  organizationId: 'org-1',
  externalUserName: 'WA User',
};

const igConv = {
  id: 'conv-3',
  platform: 'instagram_dm',
  metaAdsPageId: null,
  whatsappAccountId: null,
  externalUserId: 'ig-user-1',
  organizationId: 'org-1',
  externalUserName: 'IG User',
};

const metaPage = {
  id: 'page-1',
  pageId: 'fb-page-id',
  pageAccessToken: 'encrypted-token',
};

const waAccount = {
  id: 'wa-1',
  phoneNumberId: 'phone-1',
  encryptedCredentials: 'encrypted-creds',
};

describe('deliverMessages', () => {
  const mockDb = createMockDatabase();

  // Stub the conversation-event audit write so it doesn't count toward the
  // db.insert assertions (it's cross-cutting tracking, not delivery logic).
  let logConversationEventSpy: ReturnType<typeof vi.spyOn>;

  afterEach(() => {
    logConversationEventSpy.mockRestore();
  });

  beforeEach(() => {
    logConversationEventSpy = vi
      .spyOn(sharedAudit, 'logConversationEvent')
      .mockResolvedValue(undefined) as ReturnType<typeof vi.spyOn>;
    mockDb._resetMocks();
    mockSendTextMessage.mockReset().mockResolvedValue({ messageId: 'msg-1' });
    mockSendQuickReply.mockReset().mockResolvedValue({ messageId: 'msg-2' });
    mockSendAttachment.mockReset().mockResolvedValue({ messageId: 'msg-3' });
    mockSendTypingIndicator.mockReset().mockResolvedValue(undefined);
    mockWaSendTextMessage
      .mockReset()
      .mockResolvedValue({ messageId: 'wa-msg-1' });
    // `logError` is a shared singleton mock under `isolate: false` — clear
    // call history so `not.toHaveBeenCalled()` assertions below aren't
    // polluted by an earlier test in this file (e.g. the decrypt-failure
    // cases, which legitimately call it).
    vi.mocked(logError).mockClear();

    vi.mocked(decryptCredentials).mockReturnValue({
      accessToken: 'decrypted-token',
    } as never);
  });

  // --- Early returns ---

  it('returns early when messages list is empty', async () => {
    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [],
    });

    expect(mockDb.query.conversation.findFirst).not.toHaveBeenCalled();
  });

  it('returns when conversation is not found', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(null);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'nonexistent',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
    expect(mockWaSendTextMessage).not.toHaveBeenCalled();
  });

  // --- Meta Messenger: Happy paths ---

  it('sends Meta text message and records in DB', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello!' }],
    });

    expect(outcome).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    expect(mockSendTextMessage).toHaveBeenCalledWith('ext-user-1', 'Hello!');
    expect(mockDb.insert).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-1',
        role: 'bot',
        content: 'Hello!',
        messageType: 'text',
        externalMessageId: 'msg-1',
      })
    );
  });

  it('sends Meta quick reply with options', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        {
          type: 'quick_reply',
          text: 'Choose one:',
          quickReplyOptions: [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ],
        },
      ],
    });

    expect(mockSendQuickReply).toHaveBeenCalledWith(
      'ext-user-1',
      'Choose one:',
      [
        { contentType: 'text', title: 'Yes', payload: 'yes' },
        { contentType: 'text', title: 'No', payload: 'no' },
      ]
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'quick_reply',
        metadata: {
          options: [
            { label: 'Yes', value: 'yes' },
            { label: 'No', value: 'no' },
          ],
        },
      })
    );
  });

  it('sends Meta attachment for media messages', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        {
          type: 'media',
          mediaUrl: 'https://example.com/image.jpg',
          mediaType: 'image',
        },
      ],
    });

    expect(mockSendAttachment).toHaveBeenCalledWith(
      'ext-user-1',
      'image',
      'https://example.com/image.jpg'
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        messageType: 'attachment',
        content: 'https://example.com/image.jpg',
      })
    );
  });

  // Meta began refusing `sender_action` at scale on 2026-07-28
  // ((#100) subcode 2018048) against recipients who were still perfectly
  // messageable. The indicator bought a sub-two-second bubble and could abort
  // the real reply, so the chatbot no longer sends one at all.
  it('never sends a sender_action on the Messenger delivery path', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTypingIndicator).not.toHaveBeenCalled();
    expect(outcome).toEqual({ attempted: 1, delivered: 1, failed: 0 });
  });

  // Regression: the whole outage. A refused typing indicator threw from inside
  // the delivery try/catch, so `sendTextMessage` was never reached, the
  // recipient was written off as unreachable, and the lead was escalated to a
  // human. Even if an indicator is ever restored, delivery must survive it.
  it('delivers the reply even when every sender_action is refused', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    mockSendTypingIndicator.mockRejectedValue(
      new MetaApiError({
        error: {
          message: '(#100) Sender action failed',
          type: 'OAuthException',
          code: 100,
          error_subcode: 2018048,
        },
      })
    );

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).toHaveBeenCalledWith('ext-user-1', 'Hello');
    expect(outcome).toEqual({ attempted: 1, delivered: 1, failed: 0 });
    // No delivery_failed audit event, so nothing escalates to a human.
    expect(logConversationEventSpy).not.toHaveBeenCalled();
  });

  // The recipient in a 2018048 is NOT unreachable — 10 of the first 21 received
  // a message from the same Page within six hours. Classifying it `not_found`
  // is what made us stop sending and escalate.
  it('does not treat "Sender action failed" as an unreachable recipient', async () => {
    const senderActionError = new MetaApiError({
      error: {
        message: '(#100) Sender action failed',
        type: 'OAuthException',
        code: 100,
        error_subcode: 2018048,
      },
    });

    expect(senderActionError.category).toBe('sender_action_rejected');
    expect(senderActionError.category).not.toBe('not_found');
    // Still an expected condition, so it logs at warn and never pages.
    expect(senderActionError.isExpected).toBe(true);
  });

  it('keeps delivering later messages when a sender_action is refused mid-batch', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    mockSendTypingIndicator.mockRejectedValue(
      new MetaApiError({
        error: {
          message: '(#100) Sender action failed',
          code: 100,
          error_subcode: 2018048,
        },
      })
    );

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });

    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    expect(outcome).toEqual({ attempted: 2, delivered: 2, failed: 0 });
  });

  // --- Meta: Missing page / token ---

  it('returns when Meta page has no access token', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce({
      ...metaPage,
      pageAccessToken: null,
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('returns when no page linked to conversation (non-IG platform)', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      ...metaConv,
      metaAdsPageId: null,
      platform: 'facebook_messenger',
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // --- Meta: Decrypt error ---

  it('returns when Meta page token decryption fails', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('Decryption failed');
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // --- Meta: API errors ---

  it('breaks loop on MetaApiError with not_found category', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    // Meta (#100 / 2018001) "No matching user found" → category `not_found`.
    const notFoundError = new MetaApiError({
      error: {
        message: 'No matching user found',
        code: 100,
        error_subcode: 2018001,
      },
    });
    expect(notFoundError.category).toBe('not_found');
    mockSendTextMessage.mockRejectedValueOnce(notFoundError);

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });

    // First message fails, second should NOT be attempted
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
    // Failure is reported back so the caller won't treat it as a success.
    expect(outcome.delivered).toBe(0);
    expect(outcome.failed).toBe(1);
    // 2018001 is an EXPECTED condition (isExpected === true) — it must not
    // page Sentry. Prior behaviour called logError unconditionally here,
    // producing the 27 prod Sentry events this fix removes.
    expect(logError).not.toHaveBeenCalled();
    // A durable marker is written so a later trigger (follow_up/timeout)
    // doesn't silently re-attempt delivery and re-log the same failure.
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          undeliverable: expect.objectContaining({
            code: 100,
            subcode: 2018001,
            category: 'not_found',
            pageId: 'page-1',
          }),
        }),
      })
    );
    expect(outcome.unavailableReason).toContain('not_found');
  });

  it('logs to Sentry (logError) for an UNEXPECTED Meta error category', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    // Rate limiting is NOT in the `isExpected` set — it may indicate a real
    // problem worth watching, so it should still page Sentry.
    const rateLimitError = new MetaApiError({
      error: { message: 'Application request limit reached', code: 4 },
    });
    expect(rateLimitError.isExpected).toBe(false);
    mockSendTextMessage.mockRejectedValueOnce(rateLimitError);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(logError).toHaveBeenCalledWith(
      'chatbots.deliverMessages.send',
      rateLimitError,
      expect.anything()
    );
  });

  it('breaks loop on MetaApiError with user_blocked category', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    // Meta (#551) "This person isn't available right now" → `user_blocked`.
    const blockedError = new MetaApiError({
      error: { message: 'User blocked messaging', code: 551 },
    });
    expect(blockedError.category).toBe('user_blocked');
    mockSendTextMessage.mockRejectedValueOnce(blockedError);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });

    // First message fails, second should NOT be attempted
    expect(mockSendTextMessage).toHaveBeenCalledTimes(1);
  });

  it('continues to next message on non-unavailable Meta API error', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(metaConv);
    mockDb.query.metaAdsPage.findFirst.mockResolvedValueOnce(metaPage);

    mockSendTextMessage
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ messageId: 'msg-2' });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-1',
      messages: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });

    // Both messages attempted
    expect(mockSendTextMessage).toHaveBeenCalledTimes(2);
    // Only second message recorded — failed delivery is not persisted
    expect(mockDb.values).toHaveBeenCalledTimes(1);
  });

  // --- Instagram DM ---

  it('delivers Instagram DM via active integration', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(igConv);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      organizationId: 'org-1',
      isActive: true,
      encryptedCredentials: 'ig-encrypted',
      instagramUserId: 'ig-page-id',
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-3',
      messages: [{ type: 'text', text: 'Hello from IG' }],
    });

    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'ig-user-1',
      'Hello from IG'
    );
  });

  // ENG-846: `metaAdsPageId` is a legacy FK that can be stale/non-null on an
  // Instagram DM conversation. Branching on it alone — instead of gating on
  // `platform` first — would send an IGSID to graph.facebook.com with a
  // Facebook page token (id-type confusion, root mechanism B).
  it('routes an Instagram DM through the IG integration even when metaAdsPageId is stale', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      ...igConv,
      metaAdsPageId: 'stale-fb-page',
    });
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      organizationId: 'org-1',
      isActive: true,
      encryptedCredentials: 'ig-encrypted',
      instagramUserId: 'ig-page-id',
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-3',
      messages: [{ type: 'text', text: 'Hello from IG' }],
    });

    expect(mockDb.query.metaAdsPage.findFirst).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledWith(
      'ig-user-1',
      'Hello from IG'
    );
  });

  it('does not send typing indicator for Instagram DM', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(igConv);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      organizationId: 'org-1',
      isActive: true,
      encryptedCredentials: 'ig-encrypted',
      instagramUserId: 'ig-page-id',
    });

    const outcome = await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-3',
      messages: [{ type: 'text', text: 'No typing' }],
    });

    expect(mockSendTypingIndicator).not.toHaveBeenCalled();
    expect(mockSendTextMessage).toHaveBeenCalledWith('ig-user-1', 'No typing');
    expect(outcome).toEqual({ attempted: 1, delivered: 1, failed: 0 });
  });

  it('returns when no active Instagram integration exists', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(igConv);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce(null);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-3',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  it('returns when Instagram integration decryption fails', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(igConv);
    mockDb.query.instagramIntegration.findFirst.mockResolvedValueOnce({
      id: 'ig-int-1',
      organizationId: 'org-1',
      isActive: true,
      encryptedCredentials: 'bad-encrypted',
      instagramUserId: 'ig-page-id',
    });
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('IG decrypt failed');
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-3',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockSendTextMessage).not.toHaveBeenCalled();
  });

  // --- WhatsApp ---

  it('sends WhatsApp text message and records in DB', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [{ type: 'text', text: 'WA Hello' }],
    });

    expect(mockWaSendTextMessage).toHaveBeenCalledWith(
      'ext-wa-user',
      'WA Hello'
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conv-2',
        role: 'bot',
        content: 'WA Hello',
        messageType: 'text',
      })
    );
  });

  it('sends WhatsApp quick reply as numbered list', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [
        {
          type: 'quick_reply',
          text: 'Pick one:',
          quickReplyOptions: [
            { label: 'Option A', value: 'a' },
            { label: 'Option B', value: 'b' },
          ],
        },
      ],
    });

    expect(mockWaSendTextMessage).toHaveBeenCalledWith(
      'ext-wa-user',
      'Pick one:\n\n1. Option A\n2. Option B'
    );
  });

  it('sends WhatsApp media as text fallback', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [
        {
          type: 'media',
          mediaUrl: 'https://example.com/photo.jpg',
          mediaType: 'image',
        },
      ],
    });

    expect(mockWaSendTextMessage).toHaveBeenCalledWith(
      'ext-wa-user',
      '[Media attachment]'
    );
  });

  it('sends WhatsApp media with text as fallback', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [
        {
          type: 'media',
          text: 'Check this out',
          mediaUrl: 'https://example.com/photo.jpg',
          mediaType: 'image',
        },
      ],
    });

    expect(mockWaSendTextMessage).toHaveBeenCalledWith(
      'ext-wa-user',
      'Check this out'
    );
  });

  it('returns when WhatsApp account ID is missing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce({
      ...whatsappConv,
      whatsappAccountId: null,
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockWaSendTextMessage).not.toHaveBeenCalled();
  });

  it('returns when WhatsApp account not found in DB', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(null);

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockWaSendTextMessage).not.toHaveBeenCalled();
  });

  it('returns when WhatsApp decrypt fails', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);
    vi.mocked(decryptCredentials).mockImplementationOnce(() => {
      throw new Error('WA decrypt failed');
    });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [{ type: 'text', text: 'Hello' }],
    });

    expect(mockWaSendTextMessage).not.toHaveBeenCalled();
  });

  it('continues to next message on WhatsApp API error', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValueOnce(whatsappConv);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValueOnce(waAccount);

    mockWaSendTextMessage
      .mockRejectedValueOnce(new Error('WA API error'))
      .mockResolvedValueOnce({ messageId: 'wa-msg-2' });

    await deliverMessages({
      db: mockDb as never,
      conversationId: 'conv-2',
      messages: [
        { type: 'text', text: 'First' },
        { type: 'text', text: 'Second' },
      ],
    });

    expect(mockWaSendTextMessage).toHaveBeenCalledTimes(2);
    // Only second message recorded
    expect(mockDb.values).toHaveBeenCalledTimes(1);
  });
});
