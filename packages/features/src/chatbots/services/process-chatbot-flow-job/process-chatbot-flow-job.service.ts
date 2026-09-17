import {
  conversation,
  conversationMessage,
  organization,
} from '@borradh-workspace/database';
import type {
  ChatbotSettings,
  ConversationMetadata,
  OfferedSlot,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  redactPII,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, desc, eq, ne } from 'drizzle-orm';
import { escalateConversation } from '../../../conversations/services/escalate-conversation/escalate-conversation.service.js';
import {
  type DbConnection,
  canResolveAvailability,
  logConversationEvent,
  nativeBookingLink,
  notDeleted,
  ok,
  resolveMicrositeLinkTarget,
  usesNativeCalendar,
} from '../../../shared/index.js';
import {
  DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS,
  DEFAULT_DAYS_AHEAD,
  DEFAULT_SLOTS_TO_OFFER,
  bookDirectAppointment,
  checkBookingLinkIgnored,
  directBookingBlockedReason,
  offerBookingSlots,
  parseSlotSelection,
} from '../direct-booking/index.js';
import { deliverMessages } from '../execute-flow/index.js';
import { updateConversationFlowState } from '../execute-flow/index.js';
import { generateAIResponse } from '../generate-ai-response/index.js';
import { postProcessMessage } from '../generate-ai-response/index.js';
import type { ChatbotFlowJobPayload } from '../queue-chatbot-flow/index.js';
import {
  cancelBookingFallback,
  queueChatbotFlow,
} from '../queue-chatbot-flow/index.js';
import { isChatbotEnabledForConversation } from './chatbot-enablement.js';
import { checkContentSafety } from './content-safety.js';
import { acquireConversationLock } from './conversation-lock.js';
import {
  MAX_FOLLOW_UPS,
  MAX_MESSAGE_PARTS,
  MSG_PART_DELAY_MS,
  getFollowUpMessage,
} from './follow-up-config.js';
import { extractFormService, isLeadFormMessage } from './lead-form-message.js';
import { mapAIResultToFlowResult } from './map-ai-result-to-flow.js';
import { computeFollowUpAction } from './schedule-follow-up.js';

const logger = createLogger('ProcessChatbotFlowJob');

/**
 * Sent when the guards remove a reply in full, in place of the raw model text.
 *
 * Says only what is certainly true — a person is being fetched — and promises
 * no booking, no lookup and no callback, which is exactly the class of claim
 * that got it stripped in the first place.
 */
const GUARDED_REPLY_FALLBACK =
  "Let me get one of the team to come back to you on that — they'll pick this up shortly.";

/**
 * Parse a raw AI message into separate parts using ---MSG_BREAK--- delimiter.
 * Trims whitespace, filters empty parts, caps at MAX_MESSAGE_PARTS.
 */
export function parseMessageParts(rawMessage: string): string[] {
  return rawMessage
    .split('---MSG_BREAK---')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .slice(0, MAX_MESSAGE_PARTS);
}

import type { FlowExecutionResult } from '../execute-flow/index.js';

/**
 * Run the AI-powered chatbot path.
 * Calls generateAIResponse and maps the result to a FlowExecutionResult shape
 * so the rest of the processing (deliver, state update, follow-up) stays uniform.
 */
async function runAIPath(
  db: DbConnection,
  conv: { id: string; externalUserName: string | null; metadata: unknown },
  userMessage: string | undefined,
  triggerType: string,
  apiKey: string,
  bookingLink?: string | null
): Promise<FlowExecutionResult | null> {
  const conversationId = conv.id;

  // For follow_up triggers, generate a stage-specific follow-up message
  let message: string;
  if (triggerType === 'follow_up') {
    const metadata = (conv.metadata as ConversationMetadata | null) ?? {};
    const customerName = metadata.name ?? conv.externalUserName ?? 'there';
    const followUpStage = (metadata.followUpStage ?? 0) + 1;
    message = getFollowUpMessage(followUpStage, customerName);
  } else if (triggerType === 'timeout') {
    message =
      'Just checking in — are you still there? Let me know if you have any questions!';
  } else {
    if (!userMessage) {
      logger.warn('No message for AI path', { conversationId, triggerType });
      return null;
    }
    message = userMessage;
  }

  const result = await generateAIResponse(
    db,
    { conversationId, userMessage: message },
    apiKey
  );

  if (!result.success) {
    logger.warn('AI response generation failed', {
      conversationId,
      error: result.error.message,
    });
    return null;
  }

  return mapAIResultToFlowResult(db, conversationId, result.data, bookingLink);
}

export interface ProcessChatbotFlowJobInput {
  payload: ChatbotFlowJobPayload;
  apiKey: string | undefined;
}

/**
 * Process a chatbot flow job. Determines AI vs node-based mode,
 * executes the appropriate path, delivers messages, updates state,
 * and queues follow-up jobs.
 */
async function processChatbotFlowJobImpl(
  db: DbConnection,
  input: ProcessChatbotFlowJobInput
): Promise<void> {
  const { payload, apiKey } = input;
  const { conversationId, triggerType, skipExternalDelivery } = payload;

  // Handle deliver_part: deliver a single message part and queue next
  if (triggerType === 'deliver_part') {
    await handleDeliverPart(db, payload);
    return;
  }

  // Handle expire: mark conversation as expired
  if (triggerType === 'expire') {
    await handleExpire(db, conversationId);
    return;
  }

  // Handle booking_fallback: offer direct slots when the booking link was ignored.
  if (triggerType === 'booking_fallback') {
    await handleBookingFallback(db, payload);
    return;
  }

  // Acquire per-conversation lock to prevent concurrent AI execution
  const lock = await acquireConversationLock(conversationId);
  if (!lock.acquired) {
    logger.info('Could not acquire lock, another worker is processing', {
      conversationId,
    });
    return;
  }

  try {
    // Load conversation and org settings once for all trigger types
    const conv = await db.query.conversation.findFirst({
      where: eq(conversation.id, conversationId),
    });

    if (!conv) {
      logger.warn('Conversation not found', { conversationId });
      return;
    }

    // Bind org/conversation/platform so every line this job emits is
    // filterable by organization in BetterStack. Worker logs previously
    // carried only conversationId, which made per-org triage impossible.
    const flowLog = logger.child({
      organizationId: conv.organizationId,
      conversationId,
      platform: conv.platform,
    });

    const org = await db.query.organization.findFirst({
      where: and(
        eq(organization.id, conv.organizationId),
        notDeleted(organization)
      ),
      columns: {
        name: true,
        chatbotSettings: true,
        primaryCalendarType: true,
        primaryCalendarAccountId: true,
        // Field of record for where the org books (ENG-500).
        bookingDestination: true,
        defaultBookingLink: true,
        slug: true,
        // Needed by the in-chat booking eligibility gate: an external booking
        // URL in the custom directive outranks every rule in the prompt.
        chatbotSystemPrompt: true,
      },
    });
    const orgChatbotSettings = org?.chatbotSettings as ChatbotSettings | null;
    const followUpEnabled = orgChatbotSettings?.followUpEnabled !== false;
    const calendarConnected = org ? canResolveAvailability(org) : false;

    // Skip processing if conversation is no longer bot_handling
    if (conv.status !== 'bot_handling') {
      logger.info('Conversation no longer bot_handling, skipping', {
        conversationId,
        status: conv.status,
      });
      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId,
        event: 'bot_suppressed',
        metadata: {
          reason: 'no_longer_bot_handling',
          status: conv.status,
          triggerType,
        },
      });
      return;
    }

    // ENG-846: a prior delivery attempt found the recipient unreachable
    // (Meta `not_found`/`user_blocked`, e.g. code 100 subcode 2018001 "No
    // matching user found") and marked the conversation `undeliverable`.
    // Without this guard, every later trigger (follow_up/timeout/a stray
    // retried job) would re-attempt delivery and re-log the identical
    // failure. A new INBOUND message from the recipient is the one signal
    // that proves they are reachable again, so it clears the marker instead
    // of being suppressed.
    const convMetadataForUndeliverable =
      (conv.metadata as ConversationMetadata | null) ?? {};
    if (convMetadataForUndeliverable.undeliverable) {
      if (triggerType === 'message') {
        const { undeliverable: _cleared, ...clearedMetadata } =
          convMetadataForUndeliverable;
        await db
          .update(conversation)
          .set({ metadata: clearedMetadata })
          .where(eq(conversation.id, conversationId));
        flowLog.info(
          'Cleared undeliverable marker — new inbound message proves recipient is reachable',
          { conversationId }
        );
      } else {
        flowLog.info('Skipping trigger on undeliverable conversation', {
          conversationId,
          triggerType,
          reason: 'conversation_undeliverable',
        });
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'bot_suppressed',
          metadata: { reason: 'conversation_undeliverable', triggerType },
        });
        return;
      }
    }

    // Stale job + duplicate delivery detection for message triggers
    if (triggerType === 'message' && payload.queuedAt) {
      const [latestUserMsg, latestBotMsg] = await Promise.all([
        db.query.conversationMessage.findFirst({
          where: and(
            eq(conversationMessage.conversationId, conversationId),
            eq(conversationMessage.role, 'user')
          ),
          orderBy: [desc(conversationMessage.sentAt)],
        }),
        db.query.conversationMessage.findFirst({
          where: and(
            eq(conversationMessage.conversationId, conversationId),
            eq(conversationMessage.role, 'bot'),
            ne(conversationMessage.origin, 'backfill')
          ),
          orderBy: [desc(conversationMessage.sentAt)],
        }),
      ]);

      // Stale: a newer user message supersedes this job
      if (
        latestUserMsg?.sentAt &&
        new Date(payload.queuedAt) < latestUserMsg.sentAt
      ) {
        logger.info('Stale job detected, newer message exists', {
          conversationId,
        });
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'bot_suppressed',
          metadata: { reason: 'stale_job', triggerType },
        });
        return;
      }

      // Duplicate: bot already replied after the latest user message.
      // This catches BullMQ stalled job recovery and retry attempts after crashes.
      if (
        latestBotMsg?.sentAt &&
        latestUserMsg?.sentAt &&
        latestBotMsg.sentAt > latestUserMsg.sentAt
      ) {
        logger.info(
          'Duplicate delivery guard: bot already replied to latest message',
          {
            conversationId,
            latestBotMsgAt: latestBotMsg.sentAt.toISOString(),
            latestUserMsgAt: latestUserMsg.sentAt.toISOString(),
          }
        );
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'bot_suppressed',
          metadata: { reason: 'duplicate_delivery', triggerType },
        });
        return;
      }
    }

    // Duplicate delivery guard for non-message triggers (follow_up, timeout, delay):
    // If a bot message was sent after this job was queued, this is a recovered/retried job.
    // Note: deliver_part and expire already returned above, so only follow_up/timeout/delay remain.
    if (triggerType !== 'message' && payload.queuedAt) {
      const queuedTime = new Date(payload.queuedAt);
      const latestBotMsg = await db.query.conversationMessage.findFirst({
        where: and(
          eq(conversationMessage.conversationId, conversationId),
          eq(conversationMessage.role, 'bot'),
          ne(conversationMessage.origin, 'backfill')
        ),
        orderBy: [desc(conversationMessage.sentAt)],
      });
      if (latestBotMsg?.sentAt && latestBotMsg.sentAt > queuedTime) {
        logger.info(
          'Duplicate delivery guard: bot already sent message after job queued',
          {
            conversationId,
            triggerType,
            queuedAt: payload.queuedAt,
            latestBotMsgAt: latestBotMsg.sentAt.toISOString(),
          }
        );
        return;
      }
    }

    // Content safety pre-check (before AI call to save API cost)
    if (triggerType === 'message' && payload.userMessage) {
      const safetyResult = checkContentSafety(payload.userMessage);
      if (safetyResult.action === 'escalate') {
        logger.info('Content safety triggered escalation', {
          conversationId,
          reason: safetyResult.reason,
        });
        await escalateConversation(db, {
          conversationId,
          reason: safetyResult.reason,
          reasonDetail: safetyResult.detail,
        });
        return;
      }
    }

    // Agent activity guard for follow_up triggers
    if (triggerType === 'follow_up' && payload.queuedAt) {
      const agentMsg = await db.query.conversationMessage.findFirst({
        where: and(
          eq(conversationMessage.conversationId, conversationId),
          eq(conversationMessage.role, 'agent')
        ),
        orderBy: [desc(conversationMessage.sentAt)],
      });
      if (agentMsg?.sentAt && new Date(payload.queuedAt) < agentMsg.sentAt) {
        logger.info('Agent replied after job was queued, skipping follow-up', {
          conversationId,
        });
        return;
      }
    }

    // Handle follow_up: check if we should send a follow-up
    if (triggerType === 'follow_up') {
      const metadata = (conv.metadata as ConversationMetadata | null) ?? {};
      const followUpCount = metadata.followUpCount ?? 0;

      if (followUpCount >= MAX_FOLLOW_UPS) {
        logger.info('Max follow-ups reached, escalating', {
          conversationId,
          followUpCount,
        });
        await escalateConversation(db, {
          conversationId,
          reason: 'max_follow_ups',
          reasonDetail: `${followUpCount} follow-ups sent with no response`,
        });
        return;
      }

      // Generate follow-up via AI and continue below
    }

    // Check if the chatbot is still enabled for this conversation's page
    const chatbotStillEnabled = await isChatbotEnabledForConversation(db, conv);
    if (!chatbotStillEnabled) {
      logger.info(
        'Chatbot disabled for this page, transitioning to agent_handling',
        { conversationId }
      );
      await db
        .update(conversation)
        .set({ status: 'agent_handling' })
        .where(eq(conversation.id, conversationId));
      // Reached only when the conversation was bot_handling (narrowed above),
      // so this is always a real bot→human transition.
      trackOrgEvent(conv.organizationId, 'conversation_handed_off', {
        organizationId: conv.organizationId,
        conversationId,
        source: 'chatbot_disabled',
      });
      return;
    }

    // AI-only mode
    if (!apiKey) {
      logger.error('No API key configured, cannot process chatbot flow', {
        conversationId,
      });
      return;
    }

    // If we previously offered direct-booking slots and the lead just replied,
    // try to match the reply against those slots before invoking the model.
    // We let the AI take over for negotiation / unclear replies.
    const preAiMeta = (conv.metadata as ConversationMetadata | null) ?? {};
    if (
      triggerType === 'message' &&
      payload.userMessage &&
      preAiMeta.directBookingOfferedAt &&
      preAiMeta.offeredSlots &&
      preAiMeta.offeredSlots.length > 0 &&
      !preAiMeta.directBookingConfirmedAt
    ) {
      const slotSelection = await handleSlotSelection(
        db,
        conv,
        payload.userMessage,
        preAiMeta,
        skipExternalDelivery
      );
      if (slotSelection.handled) {
        logger.info('Slot selection handled', {
          conversationId,
          matched: slotSelection.matched,
          booked: slotSelection.booked,
        });
        return;
      }
    }

    // The link the model was actually handed, derived exactly as
    // `buildPromptContext` derives it. This used to fall back to the bare org
    // SLUG for native-calendar orgs (whose `defaultBookingLink` is null by
    // definition), which broke both consumers: push verification matched on a
    // fragment that appears in any message naming the clinic, and the
    // post-processor's "don't send the booking link twice" strip was handed
    // `undefined` and silently did nothing — so a native org kept re-sending
    // its borradh.io booking link (ENG-677).
    const effectiveBookingLink = org
      ? usesNativeCalendar(org)
        ? nativeBookingLink(
            org,
            (
              await resolveMicrositeLinkTarget(db, {
                id: conv.organizationId,
                slug: org.slug ?? '',
              })
            ).primaryDomain
          )
        : org.defaultBookingLink
      : null;

    logger.info('Using AI mode', { conversationId });
    const flowResult = await runAIPath(
      db,
      conv,
      payload.userMessage,
      triggerType,
      apiKey,
      effectiveBookingLink
    );

    if (!flowResult) {
      logger.warn('No flow result produced', { conversationId });
      return;
    }

    const {
      messages: aiMessages,
      newNodeId,
      stoppedAt,
      delayMs,
      waitingNodeId: _waitingNodeId,
      setAgentHandling,
      metadataUpdates,
      bookingConfirmed,
    } = flowResult;

    // Reassignable so a native-calendar org can swap the model's booking-link
    // push for real slots off the diary before anything is delivered.
    let messages = aiMessages;

    // For follow-up triggers, increment followUpCount and followUpStage
    let updatedMetadata = metadataUpdates;
    if (triggerType === 'follow_up') {
      const existingMeta = (conv.metadata as ConversationMetadata | null) ?? {};
      const newCount = (existingMeta.followUpCount ?? 0) + 1;
      updatedMetadata = {
        ...metadataUpdates,
        followUpCount: newCount,
        followUpStage: newCount as 1 | 2 | 3,
        followUpSentAt: new Date().toISOString(),
        stage: 'follow_up',
      };
    }

    // Safety net (lead-form / ad-attributed opening message must never be left
    // on read). A Meta lead-form auto-fill can trip the AI classifier's
    // B2B/personal buckets → silent_handoff. If the AI abstained on the FIRST
    // message of an ad-attributed OR lead-form conversation, send a normal
    // advertised-service opener and keep the bot engaged instead of going
    // silent. The prompt rule handles this in the common case; this is the
    // deterministic backstop for when the model still wobbles.
    const aiAbstained =
      stoppedAt === 'silent_handoff' ||
      messages.length === 0 ||
      !messages[0]?.text?.trim();
    if (triggerType === 'message' && aiAbstained) {
      const metaNow = (conv.metadata as ConversationMetadata | null) ?? {};
      const fromAd = !!metaNow.adMetaId;
      const fromForm = isLeadFormMessage(payload.userMessage);
      if (fromAd || fromForm) {
        const priorBotMsg = await db.query.conversationMessage.findFirst({
          where: and(
            eq(conversationMessage.conversationId, conversationId),
            eq(conversationMessage.role, 'bot'),
            ne(conversationMessage.origin, 'backfill')
          ),
        });
        if (!priorBotMsg) {
          const service =
            metaNow.adTitle ?? extractFormService(payload.userMessage) ?? null;
          const botName = orgChatbotSettings?.ownerName ?? 'the receptionist';
          const clinic = org?.name ?? 'the clinic';
          const opener = service
            ? `Hey, I'm ${botName}, the receptionist here at ${clinic}. Thanks for getting in touch about ${service} — what would you like to know about it?`
            : `Hey, I'm ${botName}, the receptionist here at ${clinic}. Thanks for getting in touch — what were you hoping to find out?`;

          flowLog.warn(
            'Lead-form/ad opening message would have been silent — overriding with advertised-service opener',
            {
              reason: 'lead_form_silence_override',
              fromAd,
              fromForm,
              hasService: !!service,
            }
          );

          const openerOutcome = await deliverMessages({
            db,
            conversationId,
            messages: [{ type: 'text', text: opener }],
            skipExternalDelivery,
          });
          // If even the deterministic lead-form opener can't be delivered
          // (e.g. Meta rejects the recipient), don't pretend we replied —
          // hand off to a human so the lead isn't silently dropped.
          if (openerOutcome.delivered === 0 && !skipExternalDelivery) {
            await escalateConversation(db, {
              conversationId,
              reason: 'delivery_failed',
              reasonDetail:
                openerOutcome.unavailableReason ??
                'Lead-form opener could not be delivered to the customer',
            });
            return;
          }
          await logConversationEvent(db, {
            organizationId: conv.organizationId,
            conversationId,
            event: 'ai_replied',
            metadata: { override: 'lead_form_silence_override' },
          });
          await updateConversationFlowState(db, {
            conversationId,
            currentNodeId: newNodeId,
            setAgentHandling: false,
            metadataUpdates: { ...updatedMetadata, stage: 'interest' },
          });
          return;
        }
      }
    }

    // ---------------------------------------------------------------------
    // Native calendar: offer real slots INSTEAD of the booking link.
    //
    // Orgs on the built-in calendar can be booked straight from the chat. The
    // deterministic slot flow (offerBookingSlots -> parseSlotSelection ->
    // bookDirectAppointment) already existed but only ran as a fallback 10
    // minutes after a link was ignored, so in practice a lead was always sent
    // to the booking page first and the diary was never offered in-chat.
    //
    // Here we intercept the model's booking-link push and replace it with the
    // three real slots. The model still decides WHEN someone wants to book
    // (intent), but every date, time and the booking itself is computed in
    // code — it never invents a slot. If availability can't be resolved we
    // leave the model's link message untouched, so the worst case is exactly
    // today's behaviour.
    // ---------------------------------------------------------------------
    let offeredDirectSlots: OfferedSlot[] | null = null;

    // HARD eligibility gate, checked independently of the env allowlist so a
    // `*` rollout or a typo can never switch on an org whose real diary lives
    // in another system. Evaluated before anything is offered.
    const directBookingBlocked = org
      ? directBookingBlockedReason({
          bookingDestination: org.bookingDestination,
          primaryCalendarType: org.primaryCalendarType,
          defaultBookingLink: org.defaultBookingLink,
          chatbotSystemPrompt: org.chatbotSystemPrompt,
        })
      : 'organization not found';

    // An org on the Borradh booking system whose data still points customers
    // elsewhere. Surfaced loudly: it needs a data fix (clearing the stale
    // booking link, or the external URL in its custom prompt) before in-chat
    // booking can safely turn on for it.
    if (
      directBookingBlocked !== null &&
      org?.bookingDestination === 'borradh'
    ) {
      flowLog.warn('In-chat booking blocked by org data', {
        reason: 'direct_booking_ineligible',
        blockedReason: directBookingBlocked,
      });
    }

    if (
      directBookingBlocked === null &&
      updatedMetadata?.bookingLinkSent === true &&
      messages.length > 0 &&
      messages[0]?.text
    ) {
      const preOfferMeta = (conv.metadata as ConversationMetadata | null) ?? {};

      // Same guards the fallback path applies: don't re-offer over an existing
      // offer, don't chase someone who already booked, respect the sales cap.
      const alreadyOffered = !!preOfferMeta.directBookingOfferedAt;
      const alreadyBooked = !!preOfferMeta.directBookingConfirmedAt;
      const atSalesCap = (preOfferMeta.bookingPushCount ?? 0) >= 2;

      if (alreadyOffered || alreadyBooked || atSalesCap) {
        flowLog.info('Skipping in-chat slot offer', {
          reason: 'direct_booking_offer_skipped',
          alreadyOffered,
          alreadyBooked,
          atSalesCap,
        });
      } else {
        const slotsResult = await offerBookingSlots(db, {
          conversationId,
          organizationId: conv.organizationId,
          slotsToOffer: DEFAULT_SLOTS_TO_OFFER,
          daysAhead: DEFAULT_DAYS_AHEAD,
        });

        if (
          slotsResult.success &&
          !slotsResult.data.noAvailability &&
          slotsResult.data.slots.length > 0
        ) {
          messages = [{ type: 'text', text: slotsResult.data.message }];
          offeredDirectSlots = slotsResult.data.slots as OfferedSlot[];
          flowLog.info('Replaced booking link with in-chat slot offer', {
            reason: 'direct_booking_offered_inline',
            slotsOffered: offeredDirectSlots.length,
          });
          // Funnel denominator. `booking_link_sent` no longer fires for these
          // conversations (no link goes out), so without this the chatbot
          // booking-conversion rate would appear to change when only the
          // instrumentation did.
          trackOrgEvent(conv.organizationId, 'direct_booking_offered', {
            organizationId: conv.organizationId,
            conversationId,
            slotsOffered: offeredDirectSlots.length,
          });
        } else {
          // No diary availability (or the lookup failed) — fall through to the
          // model's link message rather than leaving the lead with nothing.
          flowLog.info('Keeping booking link — no bookable slots', {
            reason: 'direct_booking_no_slots',
            error: slotsResult.success ? undefined : slotsResult.error.message,
          });
        }
      }
    }

    // Track whether we actually got a customer-facing reply out. A failed
    // external send (e.g. Messenger "unavailable recipient") must NOT be
    // treated as success — otherwise we stamp lastBotResponseAt, advance the
    // funnel and schedule follow-ups that also silently fail, while the lead
    // receives nothing.
    let attemptedReply = false;
    let replyDelivered = false;
    // Populated from `DeliveryOutcome.unavailableReason` when a delivery
    // attempt below fails — folded into the `delivery_failed` escalation's
    // `reasonDetail` so an agent sees WHY (e.g. "Meta not_found code
    // 100/2018001") instead of a generic message.
    let deliveryFailureDetail: string | undefined;

    // Post-process and deliver messages.
    // Diagnostic logs surface the three silent-abstain paths that
    // previously left no trail: messages.length===0 without handoff,
    // empty/whitespace text, and post-processor reducing to empty parts.
    if (messages.length > 0 && messages[0]?.text) {
      // Sales-cap enforcement: read counts from the PRE-update metadata so
      // this message's own push isn't double-counted. The flow has already
      // applied its own update to metadataUpdates, but we want the count BEFORE
      // this message was generated.
      const preUpdateMeta =
        (conv.metadata as ConversationMetadata | null) ?? {};
      const processedMessage = postProcessMessage(messages[0].text, {
        calendarConnected,
        // True when this conversation has a booking behind it: written this
        // turn, or written in an earlier one.
        //
        // The earlier-turn half matters. The guard is what stops "you're all
        // booked in" when nothing was booked — but once something IS booked,
        // that same sentence is the correct answer to "is it booked?", and a
        // per-turn flag would strip it and send a truthful reply to the
        // handoff path. `directBookingConfirmedAt` is set by both booking
        // routes (AI and deterministic slot selection), so it is the honest
        // answer to "may this conversation talk about its booking".
        calendarActionConfirmed:
          bookingConfirmed === true || !!preUpdateMeta.directBookingConfirmedAt,
        bookingPushCount: preUpdateMeta.bookingPushCount ?? 0,
        bookingLinkSent: preUpdateMeta.bookingLinkSent ?? false,
        bookingLink: effectiveBookingLink ?? undefined,
        conversationId,
      });
      const parts = parseMessageParts(processedMessage);

      const partsAllEmpty = parts.length === 0 || parts.every((p) => !p.trim());

      if (partsAllEmpty) {
        // Every sentence was stripped. In practice that means the whole reply
        // was a guarded claim — a booking that did not happen, a calendar we
        // cannot see.
        //
        // This branch used to deliver `messages`, the RAW model text, which
        // made the entire post-processor inert for single-part replies: the
        // processed string was computed, used to decide the part count, and
        // then dropped. That is why the ENG-815 exchange shipped despite two
        // guards being active — neither could reach the customer.
        //
        // Silence is not the alternative. We send the one true thing we have
        // and put a human on it.
        logger.warn('Post-processor reduced message to empty parts', {
          reason: 'post_processor_empty_parts',
          conversationId,
          debug: {
            originalLength: messages[0].text.length,
            originalPreview: redactPII(messages[0].text).slice(0, 500),
            partCount: parts.length,
          },
        });
        attemptedReply = true;
        const outcome = await deliverMessages({
          db,
          conversationId,
          messages: [{ type: 'text', text: GUARDED_REPLY_FALLBACK }],
          skipExternalDelivery,
        });
        replyDelivered = outcome.delivered > 0;
        if (!replyDelivered) deliveryFailureDetail = outcome.unavailableReason;
        await escalateConversation(db, {
          conversationId,
          reason: 'ai_silent_handoff',
          reasonDetail:
            'Bot reply was removed in full by the booking/availability guard — the customer needs a human answer',
        });
      } else if (parts.length === 1) {
        // Single message — deliver immediately. Note this delivers the
        // POST-PROCESSED text, not the model's raw output.
        attemptedReply = true;
        const outcome = await deliverMessages({
          db,
          conversationId,
          messages: [{ type: 'text', text: parts[0] }],
          skipExternalDelivery,
        });
        replyDelivered = outcome.delivered > 0;
        if (!replyDelivered) deliveryFailureDetail = outcome.unavailableReason;
        logger.info('Bot message delivered (single part)', {
          reason: 'bot_message_delivered',
          conversationId,
          debug: {
            charCount: parts[0].length,
            messagePreview: redactPII(parts[0]).slice(0, 300),
          },
        });
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'ai_replied',
          metadata: { parts: 1 },
        });
      } else {
        // Multi-part: deliver first part immediately, queue rest
        attemptedReply = true;
        const outcome = await deliverMessages({
          db,
          conversationId,
          messages: [{ type: 'text', text: parts[0] }],
          skipExternalDelivery,
        });
        replyDelivered = outcome.delivered > 0;
        if (!replyDelivered) deliveryFailureDetail = outcome.unavailableReason;
        logger.info('Bot message delivered (multi-part, first part)', {
          reason: 'bot_message_delivered',
          conversationId,
          debug: {
            partCount: parts.length,
            charCount: parts[0]?.length ?? 0,
            messagePreview: redactPII(parts[0] ?? '').slice(0, 300),
          },
        });
        await logConversationEvent(db, {
          organizationId: conv.organizationId,
          conversationId,
          event: 'ai_replied',
          metadata: { parts: parts.length },
        });

        // Queue remaining parts only if the first part actually went out —
        // otherwise the queued parts would silently fail too.
        if (parts.length > 1 && replyDelivered) {
          await queueChatbotFlow({
            conversationId,
            triggerType: 'deliver_part',
            delayMs: MSG_PART_DELAY_MS,
            pendingMessageParts: parts,
            currentPartIndex: 1,
            skipExternalDelivery,
          });
        }
      }
    } else if (messages.length > 0) {
      // First text was empty/whitespace — historical abstain-silently
      // path. Either the AI returned `message: ""` or the parts include
      // non-text shapes (quick reply, media).
      const isTextMessage = messages[0]?.type === 'text';
      if (isTextMessage) {
        flowLog.warn('AI returned message with empty/whitespace text', {
          reason: 'ai_empty_text',
          debug: {
            messageType: messages[0]?.type,
            stoppedAt,
            setAgentHandling: !!setAgentHandling,
            rawTextLength: messages[0]?.text?.length ?? 0,
          },
        });
      }
      // Non-text messages (quick reply, media) — deliver as-is
      attemptedReply = true;
      const outcome = await deliverMessages({
        db,
        conversationId,
        messages,
        skipExternalDelivery,
      });
      replyDelivered = outcome.delivered > 0;
      if (!replyDelivered) deliveryFailureDetail = outcome.unavailableReason;
    } else if (stoppedAt !== 'silent_handoff' && stoppedAt !== 'handoff') {
      // messages.length === 0 with no explicit handoff action.
      // This is the second silent-abstain surface — the AI's mapped
      // flow produced no messages and no handoff intent.
      flowLog.warn('No messages to deliver (AI produced empty result)', {
        reason: 'ai_no_messages',
        debug: {
          stoppedAt,
          setAgentHandling: !!setAgentHandling,
        },
      });
      await logConversationEvent(db, {
        organizationId: conv.organizationId,
        conversationId,
        event: 'ai_abstained',
        metadata: { stoppedAt: stoppedAt ?? null },
      });
    }

    // We swapped the link for real slots, so record what was actually offered.
    // handleSlotSelection keys off offeredSlots to match the lead's reply, and
    // bookingLinkSent must be cleared — no link went out, and leaving it set
    // would make the follow-up copy claim we'd sent one.
    if (offeredDirectSlots) {
      updatedMetadata = {
        ...updatedMetadata,
        bookingLinkSent: false,
        directBookingOfferedAt: new Date().toISOString(),
        offeredSlots: offeredDirectSlots,
      };
    }

    // Update conversation state
    await updateConversationFlowState(db, {
      conversationId,
      currentNodeId: newNodeId,
      setAgentHandling,
      metadataUpdates: updatedMetadata,
      handoffSource: stoppedAt === 'handoff' ? 'ai_handoff' : 'silent_handoff',
    });

    // The bot produced a reply but the external send failed (e.g. Messenger
    // rejected the recipient). Don't schedule follow-ups / booking fallbacks —
    // they'd silently fail too — and hand the lead to a human so they aren't
    // left on read. The delivery layer already logged the exact Meta error.
    if (attemptedReply && !replyDelivered) {
      logger.warn('Bot reply not delivered — handing off to human', {
        reason: 'reply_delivery_failed',
        conversationId,
      });
      trackOrgEvent(conv.organizationId, 'conversation_reply_delivery_failed', {
        organizationId: conv.organizationId,
        conversationId,
        platform: conv.platform,
      });
      await escalateConversation(db, {
        conversationId,
        reason: 'delivery_failed',
        reasonDetail:
          deliveryFailureDetail ??
          'Bot reply could not be delivered to the customer',
      });
      return;
    }

    // The lead booked in this turn via the AI booking path. Kill any pending
    // fallback so we don't chase someone who is already in the diary — the
    // deterministic slot flow does exactly this after its own booking.
    if (bookingConfirmed) {
      await cancelBookingFallback(conversationId);
    }

    // If the bot just sent the booking link on a native-calendar org and we
    // still have headroom under the 2-attempt sales cap, schedule a fallback
    // to offer direct slots if the link is ignored. Job ID is predictable
    // (`booking-fallback-{conversationId}`), so BullMQ rejects duplicates.
    const preMetaForFallback =
      (conv.metadata as ConversationMetadata | null) ?? {};
    const justSentBookingLink =
      updatedMetadata?.bookingLinkSent === true &&
      updatedMetadata?.bookingLinkSentAt !==
        preMetaForFallback.bookingLinkSentAt;
    const postPushCount =
      (updatedMetadata?.bookingPushCount as number | undefined) ??
      preMetaForFallback.bookingPushCount ??
      0;

    // Product analytics: the bot just delivered a booking link. Denominator for
    // the chatbot booking-conversion funnel (numerator: direct_booking_completed).
    if (justSentBookingLink) {
      trackOrgEvent(conv.organizationId, 'booking_link_sent', {
        organizationId: conv.organizationId,
        conversationId,
        pushCount: postPushCount,
      });
    }

    if (
      justSentBookingLink &&
      org?.primaryCalendarType === 'borradh' &&
      postPushCount < 2
    ) {
      await queueChatbotFlow({
        conversationId,
        triggerType: 'booking_fallback',
        delayMs: DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS,
        skipExternalDelivery,
      });
      logger.info('Scheduled direct-booking fallback', {
        conversationId,
        delayMs: DEFAULT_BOOKING_FALLBACK_TIMEOUT_MS,
        postPushCount,
      });
    }

    // Send follow-up notification if AI flagged it
    const needsFollowUp = updatedMetadata?.needsFollowUp;
    const followUpReason = updatedMetadata?.followUpReason as
      | string
      | undefined;
    if (needsFollowUp && followUpReason) {
      const existingMeta = (conv.metadata as ConversationMetadata | null) ?? {};
      if (!existingMeta.followUpNotifiedAt) {
        escalateConversation(db, {
          conversationId,
          reason: 'needs_follow_up',
          reasonDetail: followUpReason,
          insertSystemMessage: false,
        }).catch((notifyError) => {
          logger.warn('Failed to escalate for follow-up', {
            conversationId,
            error:
              notifyError instanceof Error
                ? notifyError.message
                : String(notifyError),
          });
          // Fire-and-forget escalation hides a real failure (email/DB) from
          // the chat response — surface it to Sentry. logger.warn is Pino-only.
          logError('chatbots.followUpEscalation', notifyError, {
            feature: 'chatbots',
            extra: { conversationId },
          });
        });
      }
    }

    // Queue follow-up jobs based on stop reason
    const currentMeta = (conv.metadata as ConversationMetadata | null) ?? {};
    const currentFollowUpCount =
      triggerType === 'follow_up'
        ? (currentMeta.followUpCount ?? 0) + 1
        : (currentMeta.followUpCount ?? 0);

    const followUpAction = computeFollowUpAction({
      stoppedAt,
      currentFollowUpCount,
      triggerType,
      followUpEnabled,
      delayMs,
      newNodeId,
      lastUserMessage: payload.userMessage,
    });

    switch (followUpAction.action) {
      case 'schedule_delay': {
        await queueChatbotFlow({
          conversationId,
          triggerType: 'delay',
          delayMs: followUpAction.delayMs ?? 0,
          skipExternalDelivery,
        });
        logger.info('Queued delayed flow continuation', {
          conversationId,
          delayMs: followUpAction.delayMs,
          nextNodeId: newNodeId,
        });
        break;
      }

      case 'schedule_follow_up': {
        await queueChatbotFlow({
          conversationId,
          triggerType: 'follow_up',
          delayMs: followUpAction.delayMs ?? 0,
          skipExternalDelivery,
        });
        logger.info('Queued follow-up', {
          conversationId,
          followUpNumber: followUpAction.nextFollowUpNumber,
          delayMs: followUpAction.delayMs,
        });
        break;
      }

      case 'final_follow_up':
        logger.info('Final follow-up sent, conversation will go dormant', {
          conversationId,
          followUpCount: currentFollowUpCount,
        });
        break;

      case 'skip':
        if (stoppedAt === 'silent_handoff') {
          const reason = metadataUpdates?.silentHandoffReason as
            | string
            | undefined;
          const notification = metadataUpdates?.ownerNotification as
            | string
            | undefined;
          flowLog.info('Silent handoff — no message sent to customer', {
            reason,
          });
          await logConversationEvent(db, {
            organizationId: conv.organizationId,
            conversationId,
            event: 'ai_silent_handoff',
            metadata: { reason: reason ?? null },
          });
          await escalateConversation(db, {
            conversationId,
            reason: 'ai_silent_handoff',
            reasonDetail:
              notification ||
              reason ||
              'Directive instructed bot not to respond',
            insertSystemMessage: false,
          });
        } else if (stoppedAt === 'handoff') {
          logger.info('Flow handed off to agent', { conversationId });
          await escalateConversation(db, {
            conversationId,
            reason: 'ai_handoff',
            reasonDetail: flowResult.escalationReasonDetail,
          });
        } else if (stoppedAt === 'end') {
          logger.info('Flow completed', { conversationId });
        }
        break;
    }
  } finally {
    await lock.release();
  }
}

/**
 * Handle delivering a single message part and queuing the next.
 */
async function handleDeliverPart(
  db: DbConnection,
  payload: ChatbotFlowJobPayload
): Promise<void> {
  const {
    conversationId,
    pendingMessageParts,
    currentPartIndex,
    skipExternalDelivery,
  } = payload;

  if (!pendingMessageParts || currentPartIndex == null) {
    logger.warn('deliver_part missing required fields', { conversationId });
    return;
  }

  const part = pendingMessageParts[currentPartIndex];
  if (!part) {
    logger.warn('deliver_part index out of bounds', {
      conversationId,
      currentPartIndex,
      totalParts: pendingMessageParts.length,
    });
    return;
  }

  // Check conversation is still bot_handling
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv || conv.status !== 'bot_handling') {
    logger.info('Conversation no longer bot_handling, skipping part delivery', {
      conversationId,
      status: conv?.status,
    });
    return;
  }

  // Duplicate guard: if a bot message was sent after this part was queued,
  // this is a recovered/retried job — skip to avoid duplicate parts.
  if (payload.queuedAt) {
    const queuedTime = new Date(payload.queuedAt);
    const latestBotMsg = await db.query.conversationMessage.findFirst({
      where: and(
        eq(conversationMessage.conversationId, conversationId),
        eq(conversationMessage.role, 'bot'),
        ne(conversationMessage.origin, 'backfill')
      ),
      orderBy: [desc(conversationMessage.sentAt)],
    });
    if (latestBotMsg?.sentAt && latestBotMsg.sentAt > queuedTime) {
      logger.info('Duplicate deliver_part detected, skipping', {
        conversationId,
        currentPartIndex,
        queuedAt: payload.queuedAt,
      });
      return;
    }
  }

  // Deliver this part
  await deliverMessages({
    db,
    conversationId,
    messages: [{ type: 'text', text: part }],
    skipExternalDelivery,
  });

  logger.info('Delivered message part', {
    conversationId,
    partIndex: currentPartIndex,
    totalParts: pendingMessageParts.length,
  });

  // Queue next part if there are more
  const nextIndex = currentPartIndex + 1;
  if (nextIndex < pendingMessageParts.length) {
    await queueChatbotFlow({
      conversationId,
      triggerType: 'deliver_part',
      delayMs: MSG_PART_DELAY_MS,
      pendingMessageParts,
      currentPartIndex: nextIndex,
      skipExternalDelivery,
    });
  }
}

/**
 * Handle conversation expiry after follow-up timeout.
 */
async function handleExpire(
  db: DbConnection,
  conversationId: string
): Promise<void> {
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv || conv.status !== 'bot_handling') {
    return;
  }

  await db
    .update(conversation)
    .set({ status: 'expired', closedAt: new Date() })
    .where(eq(conversation.id, conversationId));

  logger.info('Conversation expired after follow-up timeout', {
    conversationId,
  });
}

/**
 * Handle booking_fallback trigger: the booking link was sent and ignored long
 * enough; if the org runs on the native calendar and we still have sales-cap
 * headroom, offer the lead three concrete slots and stash them in metadata so
 * the next user message can be matched against them.
 *
 * Increments `bookingPushCount` because offering slots is itself a sales push
 * (per the combined 2-attempt cap).
 */
async function handleBookingFallback(
  db: DbConnection,
  payload: ChatbotFlowJobPayload
): Promise<void> {
  const { conversationId, skipExternalDelivery } = payload;

  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv) {
    logger.warn('Conversation not found for booking fallback', {
      conversationId,
    });
    return;
  }

  if (conv.status !== 'bot_handling') {
    logger.info('Conversation no longer bot_handling, skipping fallback', {
      conversationId,
      status: conv.status,
    });
    return;
  }

  const preMeta = (conv.metadata as ConversationMetadata | null) ?? {};

  // Sales-cap guard: if we already pushed twice, do not offer slots.
  if ((preMeta.bookingPushCount ?? 0) >= 2) {
    logger.info('Skipping fallback — sales cap reached', {
      conversationId,
      bookingPushCount: preMeta.bookingPushCount,
    });
    return;
  }

  // Don't offer slots after the lead already booked.
  if (preMeta.directBookingConfirmedAt) {
    logger.info('Skipping fallback — booking already confirmed', {
      conversationId,
    });
    return;
  }

  const checkResult = await checkBookingLinkIgnored(db, {
    conversationId,
    organizationId: conv.organizationId,
  });

  if (!checkResult.success || !checkResult.data.shouldOfferDirectBooking) {
    logger.info('Booking fallback check failed or not needed', {
      conversationId,
      reason: checkResult.success
        ? checkResult.data.reason
        : checkResult.error.message,
    });
    return;
  }

  const slotsResult = await offerBookingSlots(db, {
    conversationId,
    organizationId: conv.organizationId,
    slotsToOffer: DEFAULT_SLOTS_TO_OFFER,
    daysAhead: DEFAULT_DAYS_AHEAD,
  });

  if (!slotsResult.success) {
    logger.warn('Failed to fetch booking slots', {
      conversationId,
      error: slotsResult.error.message,
    });
    return;
  }

  const { message, slots, noAvailability } = slotsResult.data;

  await deliverMessages({
    db,
    conversationId,
    messages: [{ type: 'text', text: message }],
    skipExternalDelivery,
  });

  const metadataUpdates: Partial<ConversationMetadata> = {
    directBookingOfferedAt: new Date().toISOString(),
    offeredSlots: slots as OfferedSlot[],
    bookingPushCount: (preMeta.bookingPushCount ?? 0) + 1,
    lastBotResponseAt: new Date().toISOString(),
  };

  if (noAvailability) {
    metadataUpdates.stage = 'follow_up';
  }

  await updateConversationFlowState(db, {
    conversationId,
    currentNodeId: null,
    metadataUpdates,
  });

  logger.info('Offered direct booking slots', {
    conversationId,
    slotsOffered: slots.length,
    noAvailability,
    bookingPushCount: metadataUpdates.bookingPushCount,
  });
}

interface SlotSelectionHandleResult {
  handled: boolean;
  matched: boolean;
  booked: boolean;
  needsReoffer?: boolean;
}

/**
 * Handle slot selection from user message. Called from the message-trigger
 * branch when offeredSlots are pending and the lead has just replied.
 *
 * Returns `handled: false` when we want the normal AI flow to take over
 * (negotiation, unclear reply) — that way the model can still respond.
 */
async function handleSlotSelection(
  db: DbConnection,
  conv: typeof conversation.$inferSelect,
  userMessage: string,
  metadata: ConversationMetadata,
  skipExternalDelivery?: boolean
): Promise<SlotSelectionHandleResult> {
  const conversationId = conv.id;
  const offeredSlots = metadata.offeredSlots ?? [];

  if (offeredSlots.length === 0) {
    return { handled: false, matched: false, booked: false };
  }

  const parseResult = await parseSlotSelection({
    userMessage,
    offeredSlots,
  });

  if (!parseResult.success) {
    return { handled: false, matched: false, booked: false };
  }

  const { matched, selectedSlot, needsNegotiation, requestedAlternative } =
    parseResult.data;

  if (needsNegotiation) {
    logger.info('User requesting alternative slot, deferring to AI', {
      conversationId,
      requestedAlternative,
    });
    return { handled: false, matched: false, booked: false };
  }

  if (!matched || !selectedSlot) {
    return { handled: false, matched: false, booked: false };
  }

  const customerName = metadata.name ?? conv.externalUserName ?? 'Customer';

  const bookResult = await bookDirectAppointment(db, {
    conversationId,
    organizationId: conv.organizationId,
    slotIsoStart: selectedSlot.isoStart,
    slotIsoEnd: selectedSlot.isoEnd,
    // Book against the practitioner whose availability produced the slot, so
    // the appointment reduces THEIR diary. Omitting this wrote appointments
    // with practitioner_id NULL, which no availability query could subtract.
    practitionerId: selectedSlot.practitionerId,
    customerName,
    customerPhone: metadata.phone,
    customerEmail: metadata.email,
  });

  if (!bookResult.success) {
    logger.warn('Direct booking failed', {
      conversationId,
      error: bookResult.error.message,
    });
    return { handled: false, matched: true, booked: false };
  }

  const { slotTaken, confirmationMessage, appointmentId } = bookResult.data;

  await deliverMessages({
    db,
    conversationId,
    messages: [{ type: 'text', text: confirmationMessage }],
    skipExternalDelivery,
  });

  if (slotTaken) {
    // Slot was claimed between offer and confirm — try to re-offer.
    const reofferResult = await offerBookingSlots(db, {
      conversationId,
      organizationId: conv.organizationId,
      slotsToOffer: DEFAULT_SLOTS_TO_OFFER,
      daysAhead: DEFAULT_DAYS_AHEAD,
    });

    if (reofferResult.success && !reofferResult.data.noAvailability) {
      await deliverMessages({
        db,
        conversationId,
        messages: [{ type: 'text', text: reofferResult.data.message }],
        skipExternalDelivery,
      });

      await updateConversationFlowState(db, {
        conversationId,
        currentNodeId: null,
        metadataUpdates: {
          directBookingOfferedAt: new Date().toISOString(),
          offeredSlots: reofferResult.data.slots as OfferedSlot[],
          lastBotResponseAt: new Date().toISOString(),
        },
      });
    }

    return { handled: true, matched: true, booked: false, needsReoffer: true };
  }

  await updateConversationFlowState(db, {
    conversationId,
    currentNodeId: null,
    metadataUpdates: {
      directBookingConfirmedAt: new Date().toISOString(),
      lastBotResponseAt: new Date().toISOString(),
      stage: 'booking',
    },
  });

  // Lead booked — cancel any still-pending fallback so we don't re-offer.
  await cancelBookingFallback(conversationId);

  logger.info('Direct booking completed', {
    conversationId,
    appointmentId,
    slot: selectedSlot.displayTime,
  });

  return { handled: true, matched: true, booked: true };
}

export const processChatbotFlowJob = (
  db: DbConnection,
  input: ProcessChatbotFlowJobInput
) =>
  trackedResult(
    'chatbot.processChatbotFlowJob',
    async () => {
      await processChatbotFlowJobImpl(db, input);
      return ok(undefined);
    },
    {
      properties: {
        conversationId: input.payload.conversationId,
        triggerType: input.payload.triggerType,
      },
    }
  );
