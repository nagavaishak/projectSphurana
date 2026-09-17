import { createMockDatabase } from '@borradh-workspace/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type MockInstance, vi } from 'vitest';
import * as escalateConversationModule from '../../../conversations/services/escalate-conversation/escalate-conversation.service.js';
import * as bookDirectAppointmentModule from '../direct-booking/book-direct-appointment.js';
import * as checkBookingLinkIgnoredModule from '../direct-booking/check-booking-link-ignored.js';
import * as directBookingEnabledModule from '../direct-booking/direct-booking-enabled.js';
import * as offerBookingSlotsModule from '../direct-booking/offer-booking-slots.js';
import * as parseSlotSelectionModule from '../direct-booking/parse-slot-selection.js';
import * as deliverMessagesModule from '../execute-flow/deliver-messages.js';
import * as updateConversationFlowStateModule from '../execute-flow/update-conversation-flow-state.js';
import * as generateAIResponseModule from '../generate-ai-response/generate-ai-response.service.js';
import * as messagePostProcessorModule from '../generate-ai-response/message-post-processor.js';
import * as queueChatbotFlowModule from '../queue-chatbot-flow/queue-chatbot-flow.service.js';
import * as chatbotEnablementModule from './chatbot-enablement.js';
import * as contentSafetyModule from './content-safety.js';
import * as conversationLockModule from './conversation-lock.js';
import {
  parseMessageParts,
  processChatbotFlowJob,
} from './process-chatbot-flow-job.service.js';

// Downstream services are stubbed with restored `vi.spyOn`s, NOT `vi.mock`.
// `packages/features` runs `pool: 'threads'` with `isolate: false`, so every
// test file in a worker shares ONE module graph. A hoisted `vi.mock` there is
// unsafe in both directions: its bare factory persists and deletes every export
// it omits for later files, and it silently MISSES whenever an earlier file
// already imported the real module. A spy is installed at run time (load-order
// independent) and `mockRestore` keeps it from leaking.
//
// Each spy targets the SOURCE module the symbol is defined in — the `index.js`
// barrels here re-export via live getters, which `vi.spyOn` cannot redefine.
//
// Dropped from the old mock set:
//   - `DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS` / `DEFAULT_SLOTS_TO_OFFER` /
//     `DEFAULT_DAYS_AHEAD` — the faked values were identical to the real
//     constants, so the real (pure) ones are used.
//   - `../notify-follow-up-required/index.js` — nothing under test imports it.
let mockDeliverMessages: MockInstance;
let mockUpdateConversationFlowState: MockInstance;
let mockGenerateAIResponse: MockInstance;
let mockPostProcessMessage: MockInstance;
let mockQueueChatbotFlow: MockInstance;
let mockCancelBookingFallback: MockInstance;
let mockCheckBookingLinkIgnored: MockInstance;
let mockOfferBookingSlots: MockInstance;
let mockParseSlotSelection: MockInstance;
let mockBookDirectAppointment: MockInstance;
let mockDirectBookingBlockedReason: MockInstance;
let mockAcquireConversationLock: MockInstance;
let mockCheckContentSafety: MockInstance;
let mockIsChatbotEnabledForConversation: MockInstance;
let mockEscalateConversation: MockInstance;

/**
 * Install every downstream stub. Called from each `beforeEach` so the spies are
 * fresh (no `mock*Once` queue survives a test) and load-order independent.
 */
function installDownstreamSpies() {
  mockDeliverMessages = vi
    .spyOn(deliverMessagesModule, 'deliverMessages')
    .mockResolvedValue({ attempted: 1, delivered: 1, failed: 0 } as never);
  mockUpdateConversationFlowState = vi
    .spyOn(updateConversationFlowStateModule, 'updateConversationFlowState')
    .mockResolvedValue(undefined as never);
  mockGenerateAIResponse = vi
    .spyOn(generateAIResponseModule, 'generateAIResponse')
    .mockResolvedValue(undefined as never);
  mockPostProcessMessage = vi
    .spyOn(messagePostProcessorModule, 'postProcessMessage')
    .mockImplementation(((msg: string) => msg) as never);
  mockQueueChatbotFlow = vi
    .spyOn(queueChatbotFlowModule, 'queueChatbotFlow')
    .mockResolvedValue({ success: true, data: { jobId: 'j1' } } as never);
  mockCancelBookingFallback = vi
    .spyOn(queueChatbotFlowModule, 'cancelBookingFallback')
    .mockResolvedValue(undefined as never);
  mockCheckBookingLinkIgnored = vi
    .spyOn(checkBookingLinkIgnoredModule, 'checkBookingLinkIgnored')
    .mockResolvedValue({
      success: true,
      data: { shouldOfferDirectBooking: false },
    } as never);
  mockOfferBookingSlots = vi
    .spyOn(offerBookingSlotsModule, 'offerBookingSlots')
    .mockResolvedValue(undefined as never);
  mockParseSlotSelection = vi
    .spyOn(parseSlotSelectionModule, 'parseSlotSelection')
    .mockResolvedValue(undefined as never);
  mockBookDirectAppointment = vi
    .spyOn(bookDirectAppointmentModule, 'bookDirectAppointment')
    .mockResolvedValue(undefined as never);
  // These tests exercise the AI/link path, so the eligibility gate reports a
  // reason and in-chat slot offering stays out of the way.
  mockDirectBookingBlockedReason = vi
    .spyOn(directBookingEnabledModule, 'directBookingBlockedReason')
    .mockReturnValue(
      'org does not take bookings in the Borradh booking system' as never
    );
  // The real conversation lock talks to Redis.
  mockAcquireConversationLock = vi
    .spyOn(conversationLockModule, 'acquireConversationLock')
    .mockResolvedValue({
      acquired: true,
      release: vi.fn().mockResolvedValue(undefined),
    } as never);
  mockCheckContentSafety = vi
    .spyOn(contentSafetyModule, 'checkContentSafety')
    .mockReturnValue({ action: 'continue' } as never);
  mockIsChatbotEnabledForConversation = vi
    .spyOn(chatbotEnablementModule, 'isChatbotEnabledForConversation')
    .mockResolvedValue(true as never);
  mockEscalateConversation = vi
    .spyOn(escalateConversationModule, 'escalateConversation')
    .mockResolvedValue({ success: true } as never);
}

function restoreDownstreamSpies() {
  for (const spy of [
    mockDeliverMessages,
    mockUpdateConversationFlowState,
    mockGenerateAIResponse,
    mockPostProcessMessage,
    mockQueueChatbotFlow,
    mockCancelBookingFallback,
    mockCheckBookingLinkIgnored,
    mockOfferBookingSlots,
    mockParseSlotSelection,
    mockBookDirectAppointment,
    mockDirectBookingBlockedReason,
    mockAcquireConversationLock,
    mockCheckContentSafety,
    mockIsChatbotEnabledForConversation,
    mockEscalateConversation,
  ]) {
    spy?.mockRestore();
  }
}

describe('parseMessageParts', () => {
  it('should split messages by ---MSG_BREAK--- delimiter', () => {
    const parts = parseMessageParts('Hello---MSG_BREAK---World');
    expect(parts).toEqual(['Hello', 'World']);
  });

  it('should trim whitespace from parts', () => {
    const parts = parseMessageParts('  Hello  ---MSG_BREAK---  World  ');
    expect(parts).toEqual(['Hello', 'World']);
  });

  it('should filter empty parts', () => {
    const parts = parseMessageParts('Hello---MSG_BREAK------MSG_BREAK---World');
    expect(parts).toEqual(['Hello', 'World']);
  });

  it('should cap at 4 message parts', () => {
    const parts = parseMessageParts(
      'A---MSG_BREAK---B---MSG_BREAK---C---MSG_BREAK---D---MSG_BREAK---E'
    );
    expect(parts).toHaveLength(4);
    expect(parts).toEqual(['A', 'B', 'C', 'D']);
  });

  it('should return single part for message without delimiter', () => {
    const parts = parseMessageParts('Just a single message');
    expect(parts).toEqual(['Just a single message']);
  });
});

describe('processChatbotFlowJob', () => {
  const mockDb = createMockDatabase();

  const makeConversation = (overrides = {}) => ({
    id: 'conv-1',
    organizationId: 'org-1',
    status: 'bot_handling',
    metadata: {},
    externalUserName: 'Test User',
    metaAdsPageId: 'page-1',
    whatsappAccountId: null,
    platform: 'facebook_messenger',
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    installDownstreamSpies();
    // Default: chatbot is enabled for the page
    mockDb.query.metaAdsPage.findFirst.mockResolvedValue({
      isChatbotActive: true,
    });
    // Default: organization with chatbot settings
    mockDb.query.organization.findFirst.mockResolvedValue({
      chatbotSettings: null,
    });
  });

  afterEach(() => {
    restoreDownstreamSpies();
  });

  it('should process an AI-mode message trigger', async () => {
    const conv = makeConversation();
    mockDb.query.conversation.findFirst.mockResolvedValue(conv);

    mockGenerateAIResponse.mockResolvedValueOnce({
      success: true,
      data: {
        message: 'Hello!',
        stage: 'first_contact',
      },
    } as never);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'Hi',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockDeliverMessages).toHaveBeenCalled();
    expect(mockUpdateConversationFlowState).toHaveBeenCalled();
  });

  // The post-processed string used to be computed, used only to count message
  // parts, and then discarded — the single-part branch delivered the RAW model
  // text. Every guard in the post-processor was therefore inert for the
  // overwhelming majority of replies, which is why two active nets both failed
  // to stop the ENG-815 exchange from reaching a customer.
  // A native-calendar org's `defaultBookingLink` is null by definition — it is
  // the very thing that makes it eligible to book in chat. The old derivation
  // fell back to the bare org slug, so the post-processor's "don't send the
  // booking link twice" strip was handed `undefined` and did nothing: the org
  // kept re-sending its borradh.io booking link (ENG-677).
  describe('booking link derivation for native-calendar orgs (ENG-677)', () => {
    it('hands the post-processor the real booking URL, not the org slug', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockDb.query.organization.findFirst.mockResolvedValue({
        chatbotSettings: null,
        bookingDestination: 'borradh',
        primaryCalendarType: 'borradh',
        defaultBookingLink: null,
        slug: 'glow-clinic',
        chatbotSystemPrompt: null,
      });
      mockDb.query.micrositeDomain.findFirst.mockResolvedValue(null);
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: { message: 'Here you go.', bookingLinkSent: true },
      } as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: 'send me the link',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const options = mockPostProcessMessage.mock.calls[0][1] as {
        bookingLink?: string;
      };
      expect(options.bookingLink).toContain('glow-clinic');
      expect(options.bookingLink).toMatch(/^https?:\/\//);
      expect(options.bookingLink).toMatch(/\/book$/);
    });

    it('keeps using the external link for an org that books elsewhere', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockDb.query.organization.findFirst.mockResolvedValue({
        chatbotSettings: null,
        bookingDestination: 'external',
        primaryCalendarType: null,
        defaultBookingLink: 'https://fresha.com/glow',
        slug: 'glow-clinic',
        chatbotSystemPrompt: null,
      });
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: { message: 'Here you go.', bookingLinkSent: true },
      } as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: 'send me the link',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const options = mockPostProcessMessage.mock.calls[0][1] as {
        bookingLink?: string;
      };
      expect(options.bookingLink).toBe('https://fresha.com/glow');
    });
  });

  describe('post-processor output actually reaches the customer (ENG-815)', () => {
    it('delivers the processed text, not the model output it was derived from', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: {
          message: "Sure. I'm arranging that for you now.",
          stage: 'booking',
        },
      } as never);
      // What the guard leaves behind once the invented claim is removed.
      mockPostProcessMessage.mockReturnValueOnce('Sure.' as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: 'is it booked?',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const deliverArg = mockDeliverMessages.mock.calls[0][0] as {
        messages: Array<{ text: string }>;
      };
      expect(deliverArg.messages[0].text).toBe('Sure.');
      expect(deliverArg.messages[0].text).not.toMatch(/arranging/i);
    });

    it('sends a safe reply and fetches a human when the guard removes everything', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: {
          message:
            "I'm checking that for you now. I'll confirm it once it's processed.",
        },
      } as never);
      mockPostProcessMessage.mockReturnValueOnce('' as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: 'is it booked?',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      // Not the raw claim, and not silence either.
      const deliverArg = mockDeliverMessages.mock.calls[0][0] as {
        messages: Array<{ text: string }>;
      };
      expect(deliverArg.messages[0].text).not.toMatch(/checking|processed/i);
      expect(deliverArg.messages[0].text).toMatch(/one of the team/i);
      expect(mockEscalateConversation).toHaveBeenCalledWith(
        mockDb,
        expect.objectContaining({ reason: 'ai_silent_handoff' })
      );
    });

    it('allows booking language only when an appointment was actually written', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: {
          message: "You're all booked for Thursday at 2 PM.",
          stage: 'booking',
          bookingCompleted: {
            appointmentId: 'apt-1',
            confirmationCode: 'APT-ABC123',
            slotIsoStart: '2026-09-03T13:00:00.000Z',
            displayTime: '2:00 PM',
          },
        },
      } as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: '2pm please',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const postProcessOptions = mockPostProcessMessage.mock.calls[0][1] as {
        calendarActionConfirmed?: boolean;
      };
      expect(postProcessOptions.calendarActionConfirmed).toBe(true);

      // The lead is in the diary — stop chasing them.
      expect(mockCancelBookingFallback).toHaveBeenCalledWith('conv-1');
      const updateArg = mockUpdateConversationFlowState.mock.calls[0][1] as {
        metadataUpdates?: Record<string, unknown>;
      };
      expect(updateArg.metadataUpdates?.directBookingConfirmedAt).toEqual(
        expect.any(String)
      );
    });

    it('lets a later turn restate a booking made in an earlier one', async () => {
      // "is it booked?" after a real booking. The honest answer contains the
      // exact phrasing the guard exists to block, so a per-turn flag would
      // strip a true statement and hand the customer to a human.
      mockDb.query.conversation.findFirst.mockResolvedValue(
        makeConversation({
          metadata: { directBookingConfirmedAt: '2026-09-01T10:00:00.000Z' },
        })
      );
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: { message: "Yes, you're all booked in for Thursday at 5 PM." },
      } as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: 'is it booked?',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const options = mockPostProcessMessage.mock.calls[0][1] as {
        calendarActionConfirmed?: boolean;
      };
      expect(options.calendarActionConfirmed).toBe(true);
    });

    it('guards booking language when nothing was written', async () => {
      mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
      mockGenerateAIResponse.mockResolvedValueOnce({
        success: true,
        data: { message: "I'm arranging that now.", stage: 'booking' },
      } as never);

      await processChatbotFlowJob(mockDb as never, {
        payload: {
          conversationId: 'conv-1',
          userMessage: '2pm please',
          triggerType: 'message',
        },
        apiKey: 'test-key',
      });

      const postProcessOptions = mockPostProcessMessage.mock.calls[0][1] as {
        calendarActionConfirmed?: boolean;
      };
      expect(postProcessOptions.calendarActionConfirmed).toBe(false);
      expect(mockCancelBookingFallback).not.toHaveBeenCalled();
    });
  });

  it('hands off to a human and skips follow-ups when the reply fails to deliver', async () => {
    const conv = makeConversation();
    mockDb.query.conversation.findFirst.mockResolvedValue(conv);

    mockGenerateAIResponse.mockResolvedValueOnce({
      success: true,
      data: { message: 'Hello!', stage: 'first_contact' },
    } as never);

    // External send failed — nothing reached the customer.
    mockDeliverMessages.mockResolvedValueOnce({
      attempted: 1,
      delivered: 0,
      failed: 1,
    });

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'Hi',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockDeliverMessages).toHaveBeenCalledTimes(1);
    // Lead handed to a human instead of being left on read.
    expect(mockEscalateConversation).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ reason: 'delivery_failed' })
    );
    // No doomed follow-up / booking-fallback scheduled after a failed send.
    expect(mockQueueChatbotFlow).not.toHaveBeenCalled();
  });

  it('overrides AI silent_handoff on a lead-form first message with an advertised-service opener', async () => {
    // Ad-attributed conversation, opening message, AI tries to stay silent.
    const conv = makeConversation({
      metadata: { adMetaId: '123', adTitle: 'Fat Loss Red Light Therapy' },
    });
    mockDb.query.conversation.findFirst.mockResolvedValue(conv);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Glow Clinic',
      chatbotSettings: { ownerName: 'Claire' },
    });
    // No prior bot message → this is the first engagement (default mock = null).

    mockGenerateAIResponse.mockResolvedValueOnce({
      success: true,
      data: {
        message: '',
        action: 'silent_handoff',
        silentHandoffReason: 'Looked like a B2B message',
        ownerNotification: 'Form fill from Sarah',
      },
    } as never);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage:
          'Hello! I filled out your form and would like to know more about your business. Email: x@y.com Full name: Sarah Phone number: 0871234567',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    // Bot replied instead of going silent...
    expect(mockDeliverMessages).toHaveBeenCalledTimes(1);
    const deliverArg = mockDeliverMessages.mock.calls[0][0] as {
      messages: Array<{ text: string }>;
    };
    expect(deliverArg.messages[0].text).toContain('Fat Loss Red Light Therapy');
    expect(deliverArg.messages[0].text).toContain('Glow Clinic');
    // ...and it did NOT hand off to a human.
    const updateArg = mockUpdateConversationFlowState.mock.calls[0][1] as {
      setAgentHandling?: boolean;
    };
    expect(updateArg.setAgentHandling).toBe(false);
  });

  it('does NOT override silent_handoff for a normal (non-ad, non-form) message', async () => {
    const conv = makeConversation({ metadata: {} });
    mockDb.query.conversation.findFirst.mockResolvedValue(conv);

    mockGenerateAIResponse.mockResolvedValueOnce({
      success: true,
      data: {
        message: '',
        action: 'silent_handoff',
        silentHandoffReason: 'spam',
      },
    } as never);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'love your content 😍',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    // Genuine silent handoff is preserved — no opener delivered.
    expect(mockDeliverMessages).not.toHaveBeenCalled();
  });

  it('should return early when no apiKey (AI-only mode)', async () => {
    const conv = makeConversation();
    mockDb.query.conversation.findFirst.mockResolvedValue(conv);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'Hi',
        triggerType: 'message',
      },
      apiKey: undefined,
    });

    expect(result.success).toBe(true);
    expect(mockGenerateAIResponse).not.toHaveBeenCalled();
    expect(mockDeliverMessages).not.toHaveBeenCalled();
  });

  it('should skip processing when conversation is not bot_handling', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(
      makeConversation({ status: 'agent_handling' })
    );

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'Hi',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockGenerateAIResponse).not.toHaveBeenCalled();
    expect(mockDeliverMessages).not.toHaveBeenCalled();
  });

  // ENG-846: a prior job marked the conversation `undeliverable` after Meta
  // rejected the recipient (e.g. code 100/2018001). A non-inbound trigger
  // (follow_up/timeout/a stray retried job) must not re-attempt delivery and
  // re-log the same failure.
  it('skips a non-message trigger on an undeliverable conversation', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(
      makeConversation({
        metadata: {
          undeliverable: {
            at: '2026-01-01T00:00:00.000Z',
            code: 100,
            subcode: 2018001,
            category: 'not_found',
          },
        },
      })
    );

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: { conversationId: 'conv-1', triggerType: 'follow_up' },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockGenerateAIResponse).not.toHaveBeenCalled();
    expect(mockDeliverMessages).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  // A new INBOUND message is the one signal that proves the recipient is
  // reachable again — it clears the marker and processing continues as
  // normal, instead of being suppressed.
  it('clears the undeliverable marker on a new inbound message and continues processing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(
      makeConversation({
        metadata: {
          name: 'Jane',
          undeliverable: {
            at: '2026-01-01T00:00:00.000Z',
            code: 100,
            subcode: 2018001,
            category: 'not_found',
          },
        },
      })
    );
    mockGenerateAIResponse.mockResolvedValueOnce({
      success: true,
      data: { message: 'Hello again!', stage: 'first_contact' },
    } as never);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        userMessage: 'Hi, are you still there?',
        triggerType: 'message',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    // The marker is cleared via a metadata update...
    expect(mockDb.update).toHaveBeenCalled();
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.not.objectContaining({
          undeliverable: expect.anything(),
        }),
      })
    );
    // ...but the OTHER field on metadata (name) survives the clear.
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ name: 'Jane' }),
      })
    );
    // ...and processing continues normally rather than being suppressed.
    expect(mockGenerateAIResponse).toHaveBeenCalled();
    expect(mockDeliverMessages).toHaveBeenCalled();
  });

  it('should handle deliver_part trigger', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        triggerType: 'deliver_part',
        pendingMessageParts: ['Part 1', 'Part 2'],
        currentPartIndex: 0,
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockDeliverMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ type: 'text', text: 'Part 1' }],
      })
    );
    // Should queue next part
    expect(mockQueueChatbotFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        triggerType: 'deliver_part',
        currentPartIndex: 1,
      })
    );
  });

  it('should handle expire trigger by marking conversation expired', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(makeConversation());
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        triggerType: 'expire',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
    expect(mockDb.update).toHaveBeenCalled();
  });

  it('should mark dormant after max follow-ups', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(
      makeConversation({ metadata: { followUpCount: 3 } })
    );
    mockDb.query.organization.findFirst.mockResolvedValue({
      chatbotSettings: null,
    });

    const result = await processChatbotFlowJob(mockDb as never, {
      payload: {
        conversationId: 'conv-1',
        triggerType: 'follow_up',
      },
      apiKey: 'test-key',
    });

    expect(result.success).toBe(true);
  });
});
