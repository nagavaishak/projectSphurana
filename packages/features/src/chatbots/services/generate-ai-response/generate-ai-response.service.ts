import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import {
  conversation,
  conversationMessage,
  organization,
  organizationLocation,
} from '@borradh-workspace/database';
import type { ConversationMetadata } from '@borradh-workspace/database';
import {
  createLogger,
  redactPII,
  trackedResult,
} from '@borradh-workspace/observability';
import { branchSegmentFor } from '@borradh-workspace/web-shared';
import { and, asc, count, desc, eq, ne } from 'drizzle-orm';
import { updateAppointment } from '../../../appointments/services/update-appointment/index.js';
import { getKnowledgeForChatbot } from '../../../assistant/knowledge/chatbot-query.js';
import { checkAvailability } from '../../../calendar/services/check-availability/index.js';
import { createWebsiteFetchTool } from '../../../conversations/tools/website-fetch.tool.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
  resolveMicrositeLinkTarget,
  zonedWallTimeToUtc,
} from '../../../shared/index.js';
import {
  bookDirectAppointment,
  directBookingBlockedReason,
  spreadSlots,
} from '../direct-booking/index.js';
import { evaluateReschedulePolicy } from '../evaluate-reschedule-policy/index.js';
import { buildPromptContext } from './build-prompt-context.js';
import type { ReturningSenderContext } from './conversation-context-builder.js';
import {
  type AIResponseResult,
  type GenerateAIResponseInput,
  generateAIResponseSchema,
} from './generate-ai-response.schema.js';
import { parseAIResponse } from './parse-ai-response.js';
import { resolveLeadEnquiry } from './resolve-lead-enquiry.js';
import { resolveOrganizationServices } from './resolve-organization-services.js';
import { resolveRelativeDate } from './resolve-relative-date.js';
import { resolveUserProfile } from './resolve-user-profile.js';

const calendarLogger = createLogger('ChatbotCalendar');
const logger = createLogger('GenerateAIResponse');

const MAX_HISTORY_MESSAGES = 20;
/**
 * Budget for the VISIBLE reply. The chatbot runs on the workspace default
 * (`MODELS.chat` — a GPT-5.x reasoning model), so `packages/ai` adds reasoning
 * headroom on top of this before sending `max_completion_tokens`; the number
 * here still means "room for the answer".
 *
 * The five completion calls below previously passed `temperature: 0.7`. GPT-5.x
 * rejects that parameter outright, so it has been removed rather than left in
 * place as config that is silently dropped.
 */
const AI_MAX_TOKENS = 1000;

/**
 * How many of a day's real slots are put in front of the model.
 *
 * This used to be 5 taken off the FRONT of the day, which is what made every
 * clinic look like it shut at noon (ENG-814). The cap now exists only to keep
 * the prompt bounded; the slots under it are spread across opening hours, and
 * a normal day at 30-minute granularity fits inside it whole.
 */
const MAX_SLOTS_IN_PROMPT = 24;

/** Cheap sanity check before handing a stored value to an email-validated field. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Normalise the model's requested time to the `HH:MM` 24-hour form that
 * `checkAvailability` reports slots in, so the two can be compared exactly.
 *
 * The prompt asks for `HH:MM`, but models routinely answer "2:00 PM" or "2pm".
 * Returns null when nothing time-shaped is present, which the caller treats
 * as "no matching slot" — never as "book something near it".
 */
export function normalizeSlotTime(raw: string): string | null {
  const match = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?$/i);
  if (!match) return null;

  let hour = Number.parseInt(match[1], 10);
  const minute = match[2] ? Number.parseInt(match[2], 10) : 0;
  const meridiem = match[3]?.toLowerCase().replace(/\./g, '');

  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;

  if (hour > 23 || minute > 59) return null;
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

/**
 * What to say when the time the model asked for cannot be booked: the real
 * alternatives off the diary, or an honest "nothing left that day".
 *
 * Deliberately deterministic rather than a further model turn. This runs at
 * the exact moment the model has just been told its booking did not happen,
 * which is when it is most likely to reach for "I'm getting that sorted".
 */
export function buildAlternativesMessage(
  slots: { displayTime: string }[],
  cause: 'unavailable' | 'taken' = 'unavailable'
): string {
  const opener =
    cause === 'taken'
      ? "Sorry, that one's just gone."
      : "Sorry, I don't have that time free.";

  const alternatives = spreadSlots(slots, 3);
  if (alternatives.length === 0) {
    return `${opener} There's nothing else left that day. Want me to check another day for you?`;
  }

  const times = alternatives.map((s) => s.displayTime).join(', ');
  return `${opener} What I do have that day is ${times}. Would any of those suit?`;
}

const generateAIResponseImpl = async (
  db: DbConnection,
  input: GenerateAIResponseInput,
  apiKey: string
): Promise<Result<AIResponseResult>> => {
  const parsed = generateAIResponseSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, userMessage } = parsed.data;

  // 1. Load conversation
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  // 2. Load organization (chatbot config is now on the org)
  const org = await db.query.organization.findFirst({
    where: and(
      eq(organization.id, conv.organizationId),
      notDeleted(organization)
    ),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // 3. Load organization locations
  const locations = await db.query.organizationLocation.findMany({
    where: eq(organizationLocation.organizationId, org.id),
    orderBy: [
      desc(organizationLocation.isPrimary),
      asc(organizationLocation.sortOrder),
    ],
  });

  // 3b. Which host this org's booking links belong on. Resolved ONCE per turn
  // and threaded through both the per-service URLs and the prompt's booking
  // link — a tenant with a live custom domain must never be quoted our domain.
  const linkTarget = await resolveMicrositeLinkTarget(db, {
    id: org.id,
    slug: org.slug ?? '',
  });

  // The branch this conversation is about, resolved from the list already
  // loaded above rather than re-queried. Null when the conversation has no
  // branch, in which case the prompt says nothing about branch pricing and
  // behaves exactly as before.
  //
  // Resolved BEFORE the services call because it feeds it twice over: the
  // price override keys on the id, and the booking link carries the segment.
  // Those two must name the same branch — quoting Cork's price beside a link
  // to Dublin is worse than either mistake alone.
  const activeLocation = conv.locationId
    ? (locations.find((l) => l.id === conv.locationId) ?? null)
    : null;
  const activeLocationName = activeLocation
    ? (activeLocation.name ?? activeLocation.city)
    : null;
  // One segment, used for BOTH the per-service booking links and the generic
  // one in the prompt. They named different branches while the generic link
  // was built branch-less, which is the bug the booking-link spec caught.
  const activeBranchSegment = activeLocation
    ? branchSegmentFor(activeLocation)
    : null;

  // 4. Resolve services (3-tier fallback: ad referral → page ads → all org)
  const convMetadata = conv.metadata as ConversationMetadata | null;
  const { services } = await resolveOrganizationServices(db, {
    organizationId: org.id,
    orgSlug: org.slug,
    convMetadata,
    primaryCalendarType: org.primaryCalendarType,
    defaultBookingLink: org.defaultBookingLink,
    metaAdsPageId: conv.metaAdsPageId,
    // Currency for the derived price string — primary location's country
    // (the resolver falls back to EUR when unknown).
    orgCountry: locations[0]?.country ?? null,
    micrositePrimaryDomain: linkTarget.primaryDomain,
    // The branch this conversation is about, resolved from the ad it came from
    // (see `resolveConversationBranch`). Null for a multi-branch org that has
    // told us nothing, in which case the org's own prices are quoted — a guess
    // here would be a wrong number said to a real customer.
    locationId: conv.locationId,
    // `slug ?? id`, so a branch with no slug yet is still named in the link.
    branchSegment: activeBranchSegment,
    org,
  });

  // 5. Load conversation history (exclude backfilled messages — they predate the AI
  // and may contain human agent responses that would confuse the model)
  const history = await db.query.conversationMessage.findMany({
    where: and(
      eq(conversationMessage.conversationId, conversationId),
      ne(conversationMessage.origin, 'backfill')
    ),
    orderBy: [desc(conversationMessage.createdAt)],
    limit: MAX_HISTORY_MESSAGES,
  });

  const chronologicalHistory = history.reverse();
  const isReturningConversation = chronologicalHistory.some(
    (m) => m.role === 'bot'
  );

  // 5b. Compute returning sender context (total messages in this conversation)
  let returningSender: ReturningSenderContext | null = null;
  if (isReturningConversation) {
    const [msgCount] = await db
      .select({ count: count() })
      .from(conversationMessage)
      .where(
        and(
          eq(conversationMessage.conversationId, conversationId),
          eq(conversationMessage.role, 'user'),
          ne(conversationMessage.origin, 'backfill')
        )
      );
    const totalMessages = msgCount?.count ?? 0;
    const daysSinceFirstContact = Math.max(
      0,
      Math.floor(
        (Date.now() - new Date(conv.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      )
    );
    returningSender = {
      totalMessages,
      firstContactDate: new Date(conv.createdAt),
      daysSinceFirstContact,
    };
  }

  // 6. Resolve user profile name
  const rawMetadata = (conv.metadata as ConversationMetadata | null) ?? null;
  const { updatedMetadata } = await resolveUserProfile(db, {
    conversationId,
    externalUserId: conv.externalUserId,
    platform: conv.platform,
    metaAdsPageId: conv.metaAdsPageId,
    existingSenderName: conv.externalUserName,
    rawMetadata,
  });

  const conversationMetadata = updatedMetadata;

  // 6c. Resolve what the customer originally enquired about via a Meta lead
  //     form, so the bot knows the service even when the ad/referral carries
  //     none. Uses the freshest metadata (phone/email may have just been
  //     captured) to late-link Messenger/IG lead-form leads. Best-effort: a
  //     failure here must never block the AI response.
  let leadEnquiryBlock: string | undefined;
  try {
    const leadEnquiry = await resolveLeadEnquiry(db, {
      id: conv.id,
      organizationId: conv.organizationId,
      platform: conv.platform,
      externalUserId: conv.externalUserId,
      metadata: conversationMetadata,
    });
    if (leadEnquiry) {
      const parts: string[] = [];
      if (leadEnquiry.serviceName) {
        parts.push(
          `The customer submitted a lead form for "${leadEnquiry.serviceName}". When they ask about pricing, availability or details without naming a treatment, assume they mean ${leadEnquiry.serviceName} and answer directly — don't ask them to confirm which service.`
        );
      }
      if (leadEnquiry.enquiryText) {
        parts.push(`What they submitted:\n${leadEnquiry.enquiryText}`);
      }
      leadEnquiryBlock = parts.join('\n');
    }
  } catch (error) {
    logger.warn('Lead enquiry resolution failed, continuing without it', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // 6b. Voice cloning disabled in production for now — use /dashboard/voice-test to compare
  const voiceStyleProfile: string | undefined = undefined;
  const voiceExamples:
    | { customerMessage: string; businessReply: string }[]
    | undefined = undefined;

  // 7. Build prompts
  const { systemPrompt, userPrompt, calendarConnected } = buildPromptContext({
    organization: org,
    activeLocationName,
    branchSegment: activeBranchSegment,
    micrositePrimaryDomain: linkTarget.primaryDomain,
    services,
    locations: locations.map((loc) => ({
      name: loc.name,
      addressLine1: loc.addressLine1,
      addressLine2: loc.addressLine2,
      city: loc.city,
      county: loc.county,
      postalCode: loc.postalCode,
      country: loc.country,
    })),
    conversationMetadata,
    isReturningConversation,
    returningSender,
    messageHistory: chronologicalHistory.map((m) => ({
      role: m.role,
      content: m.content,
    })),
    userMessage,
    leadEnquiry: leadEnquiryBlock,
    voiceStyleProfile,
    voiceExamples,
  });

  // 7b. Append dynamic knowledge base context (from knowledge_entry table)
  const knowledgeContext = await getKnowledgeForChatbot(db, {
    organizationId: org.id,
  });
  let enhancedSystemPrompt = systemPrompt;
  if (knowledgeContext) {
    enhancedSystemPrompt += `\n\n## Additional Knowledge\nThe following insights come from your business data and industry patterns. Use them to give more informed, specific responses. Reference these naturally — don't list them to the customer.\n\n${knowledgeContext}`;
  }

  // 8. Ensure AI client is initialized
  if (!isAIClientInitialized()) {
    initAIClient({ apiKey });
  }

  // PostHog LLM-observability attribution for every completion in this turn.
  // The chatbot runs in a webhook/queue worker with no ambient request
  // context, so org/conversation are passed explicitly: events attribute to
  // the org group and group into one trace per conversation. Person-less
  // (end customers aren't app users) — `distinctId` is the org id.
  const aiObservability = {
    distinctId: org.id,
    traceId: conversationId,
    spanName: 'chatbots.generateAiResponse',
    groups: { organization: org.id },
  };

  // 9. First AI call. The OpenAI client bounds this with a per-request timeout
  // and retries transient 429/5xx, but a final failure still throws — guard it
  // so the worker logs a classified error with conversation context instead of
  // surfacing an opaque uncaught 500.
  let aiResult: Awaited<ReturnType<typeof chatCompletion>>;
  try {
    aiResult = await chatCompletion(userPrompt, {
      systemMessage: enhancedSystemPrompt,
      maxTokens: AI_MAX_TOKENS,
      jsonResponse: true,
      observability: aiObservability,
    });
  } catch (err) {
    logger.error('First AI completion failed', {
      reason: 'ai_completion_failed',
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  let response = parseAIResponse(aiResult.content, conversationId);

  logger.info('AI response received', {
    reason: 'ai_response_parsed',
    conversationId,
    debug: {
      rawResponse: redactPII(aiResult.content ?? '').slice(0, 2000),
      parsedMessagePreview: redactPII(response.message ?? '').slice(0, 500),
      messageLength: response.message?.length ?? 0,
      hasMessage: !!response.message?.trim(),
      action: response.action ?? null,
      stage: response.stage ?? null,
      treatmentsMentioned: response.treatmentsMentioned ?? [],
      bookingInterest: !!response.bookingInterest,
      bookingLinkSent: !!response.bookingLinkSent,
      bookingPushed: !!response.bookingPushed,
      needsFollowUp: !!response.needsFollowUp,
      followUpReason: response.followUpReason ?? null,
      silentHandoffReason: response.silentHandoffReason ?? null,
      checkAvailability: response.checkAvailability ?? null,
    },
  });

  // 10. Check if AI wants to fetch website data (two-pass approach)
  try {
    const parsedJson = JSON.parse(aiResult.content);
    if (parsedJson.fetchWebsite?.url && parsedJson.fetchWebsite?.query) {
      const fetchUrl = parsedJson.fetchWebsite.url as string;
      const websiteQuery = parsedJson.fetchWebsite.query as string;

      const tool = createWebsiteFetchTool({ apiKey });
      const toolResult = await tool.execute(
        { url: fetchUrl, query: websiteQuery },
        {
          organizationId: org.id,
          conversationId,
        }
      );

      if (toolResult.success && toolResult.data) {
        // Second pass: generate final response with website data
        const enhancedPrompt = `${userPrompt}

--- Website Data (fetched from ${fetchUrl}) ---
${toolResult.data}

Now respond to the customer's question using this information. Remember to respond in the required JSON format.`;

        const secondResult = await chatCompletion(enhancedPrompt, {
          systemMessage: enhancedSystemPrompt,
          maxTokens: AI_MAX_TOKENS,
          jsonResponse: true,
          observability: aiObservability,
        });

        response = parseAIResponse(secondResult.content, conversationId);
        response.usedWebsiteFetch = true;
        logger.info('AI response after website fetch pass', {
          reason: 'ai_response_pass_2_website',
          conversationId,
          debug: {
            rawResponse: redactPII(secondResult.content ?? '').slice(0, 2000),
            parsedMessagePreview: redactPII(response.message ?? '').slice(
              0,
              500
            ),
            action: response.action ?? null,
          },
        });
      }
    }
  } catch (err) {
    // Previously a bare catch — log so we know when the website-fetch
    // path threw silently.
    logger.warn('Website fetch path threw, using first AI response', {
      reason: 'website_fetch_failed',
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 11. Check if AI wants to check calendar availability (two-pass approach)
  if (calendarConnected && response.checkAvailability?.date) {
    try {
      const availRequest = response.checkAvailability;
      const requestDate = availRequest.date;
      if (!requestDate) throw new Error('No date in availability request');

      // Resolve relative dates like "tomorrow" in the org's timezone.
      const resolvedDate = resolveRelativeDate(requestDate, org.timezone);

      calendarLogger.info('AI requested availability check', {
        conversationId,
        date: resolvedDate,
        timePreference: availRequest.timePreference,
      });

      const availResult = await checkAvailability(db, {
        organizationId: org.id,
        date: resolvedDate,
        timePreference: availRequest.timePreference ?? 'any',
        timezone: org.timezone,
      });

      if (availResult.success) {
        const { slots, message: availMessage } = availResult.data;

        // The whole day, not its first hour. `.slice(0, 5)` here was the
        // truncation behind ENG-814: the model is instructed to offer ONLY
        // what it was shown, and it was only ever shown the earliest five, so
        // a clinic open until 19:00 could not offer a single afternoon time.
        const shownSlots = spreadSlots(slots, MAX_SLOTS_IN_PROMPT);
        const slotsText =
          shownSlots.length > 0
            ? shownSlots.map((s) => `${s.displayTime} (${s.date})`).join(', ')
            : 'No available slots on this date.';

        const calendarPrompt = `${userPrompt}

--- Calendar Availability (${resolvedDate}) ---
${availMessage}
Available slots: ${slotsText}

These are the clinic's REAL free times for that day. Offer only times from this list, and never invent one.
Do not recite the whole list. Offer 2 or 3 spread across the day, an early one, a middle one and a later one, and say there are more if none of those suit. If the customer asked for a particular part of the day, offer times from that part.
If no slots are available, suggest checking another day. Remember to respond in the required JSON format.`;

        const calendarResult = await chatCompletion(calendarPrompt, {
          systemMessage: enhancedSystemPrompt,
          maxTokens: AI_MAX_TOKENS,
          jsonResponse: true,
          observability: aiObservability,
        });

        response = parseAIResponse(calendarResult.content, conversationId);
        // Clear the checkAvailability field since it was handled
        response.checkAvailability = undefined;
        logger.info('AI response after calendar pass', {
          reason: 'ai_response_pass_2_calendar',
          conversationId,
          debug: {
            rawResponse: redactPII(calendarResult.content ?? '').slice(0, 2000),
            parsedMessagePreview: redactPII(response.message ?? '').slice(
              0,
              500
            ),
            action: response.action ?? null,
          },
        });
      }
    } catch (err) {
      // Previously swallowed — log the failure reason.
      calendarLogger.warn('Calendar availability check failed', {
        reason: 'calendar_check_failed',
        conversationId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 11b. Handle a booking request.
  //
  // The prompt has told the model since v6 that it can book ("To BOOK AN
  // APPOINTMENT, include in your JSON response: bookAppointment: {...}"), and
  // `parseAIResponse` has always read the field back off the completion — but
  // nothing anywhere acted on it. The model duly emitted it, told the customer
  // "I'm arranging that for you now", and the field was dropped on the floor:
  // no appointment row, no queued work, and nothing that could later "process"
  // and produce the confirmation it had promised. That is ENG-815 (Claire
  // claims a booking is being arranged when nothing is) and the booking half
  // of ENG-677 (Claire never actually books anyone in).
  //
  // The model chooses WHICH slot. It never decides whether that slot exists:
  // the time is re-checked against real availability here, and the write goes
  // through `bookDirectAppointment`, which re-validates the slot, holds it,
  // and is the same primitive the deterministic slot-selection flow uses.
  if (
    calendarConnected &&
    response.bookAppointment?.date &&
    response.bookAppointment?.time
  ) {
    const bookRequest = response.bookAppointment;
    // Consumed either way — a request we could not honour must never survive
    // into the response and look like a pending action.
    response.bookAppointment = undefined;

    // Same hard gate the in-chat slot offer uses. An org whose real diary
    // lives in another system must not have a second system accepting
    // appointments for the same chair.
    const blockedReason = directBookingBlockedReason({
      bookingDestination: org.bookingDestination,
      primaryCalendarType: org.primaryCalendarType,
      defaultBookingLink: org.defaultBookingLink,
      chatbotSystemPrompt: org.chatbotSystemPrompt,
    });

    if (blockedReason) {
      // Nothing is booked, so nothing may be claimed. The post-processor's
      // booking guards strip the model's claim; we only record why.
      calendarLogger.warn('AI booking request refused', {
        reason: 'direct_booking_ineligible',
        conversationId,
        blockedReason,
      });
    } else {
      try {
        const resolvedDate = resolveRelativeDate(
          bookRequest.date,
          org.timezone
        );
        const requestedTime = normalizeSlotTime(bookRequest.time);

        calendarLogger.info('AI requested booking', {
          conversationId,
          date: resolvedDate,
          time: requestedTime,
        });

        const availResult = await checkAvailability(db, {
          organizationId: org.id,
          date: resolvedDate,
          timePreference: 'any',
          timezone: org.timezone,
        });

        const daySlots = availResult.success ? availResult.data.slots : [];
        const slot = requestedTime
          ? daySlots.find((s) => s.startTime === requestedTime)
          : undefined;

        if (!slot) {
          // The model asked for a time the diary does not have. Answer from
          // the diary rather than letting it improvise a confirmation.
          response.message = buildAlternativesMessage(daySlots);
          calendarLogger.info('AI booking request did not match a real slot', {
            reason: 'direct_booking_slot_not_found',
            conversationId,
            date: resolvedDate,
            requestedTime,
            slotsOnDay: daySlots.length,
          });
        } else {
          const bookResult = await bookDirectAppointment(db, {
            conversationId,
            organizationId: org.id,
            slotIsoStart: slot.isoStart,
            slotIsoEnd: slot.isoEnd,
            // Book against the practitioner whose availability produced the
            // slot, so the appointment reduces THEIR diary.
            practitionerId: slot.practitionerId,
            customerName:
              conversationMetadata?.name ??
              conv.externalUserName ??
              bookRequest.customerName ??
              'Customer',
            customerPhone:
              conversationMetadata?.phone ?? bookRequest.customerPhone,
            // Only when it is actually an address. `bookDirectAppointment`
            // validates this field, so a junk value scraped into metadata
            // would fail the whole booking rather than just be dropped.
            customerEmail: EMAIL_SHAPE.test(conversationMetadata?.email ?? '')
              ? conversationMetadata?.email
              : undefined,
          });

          if (bookResult.success && !bookResult.data.slotTaken) {
            // The confirmation is generated from the row that was just
            // written, in the clinic's timezone — not paraphrased by the
            // model, which is how a booking that did not happen got described
            // as one that did.
            response.message = bookResult.data.confirmationMessage;
            response.stage = 'booking';
            response.bookingCompleted = {
              appointmentId: bookResult.data.appointmentId,
              confirmationCode: bookResult.data.confirmationCode,
              slotIsoStart: slot.isoStart,
              displayTime: slot.displayTime,
            };
            calendarLogger.info('AI booking completed', {
              reason: 'direct_booking_completed_ai',
              conversationId,
              appointmentId: bookResult.data.appointmentId,
              slot: slot.displayTime,
            });
          } else if (bookResult.success) {
            // Claimed by someone else between the availability check and the
            // write. Re-offer from the diary; claim nothing.
            const remaining = await checkAvailability(db, {
              organizationId: org.id,
              date: resolvedDate,
              timePreference: 'any',
              timezone: org.timezone,
            });
            response.message = buildAlternativesMessage(
              remaining.success ? remaining.data.slots : [],
              'taken'
            );
            calendarLogger.info('AI booking slot was taken', {
              reason: 'direct_booking_slot_taken_ai',
              conversationId,
              slot: slot.displayTime,
            });
          } else {
            // The write failed for a reason that is NOT "someone beat us to
            // it" — telling the customer their slot went would be a second
            // invention on top of the first. Say what is true and get a human.
            response.message =
              "Sorry, I couldn't get that booked just now. Let me get one of the team to sort it for you.";
            response.action = 'handoff';
            response.silentHandoffReason = `In-chat booking failed for ${slot.date} ${slot.displayTime}: ${bookResult.error.message}`;
            calendarLogger.warn('AI booking did not complete', {
              reason: 'direct_booking_failed_ai',
              conversationId,
              error: bookResult.error.message,
            });
          }
        }
      } catch (err) {
        calendarLogger.warn('AI booking request failed', {
          reason: 'direct_booking_error_ai',
          conversationId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // 12. Handle reschedule intent (two-pass approach, similar to availability).
  // Only runs when the org has a connected calendar and the AI detected a
  // reschedule request.
  if (calendarConnected && response.rescheduleAppointment) {
    try {
      calendarLogger.info('AI detected reschedule intent', { conversationId });

      const rescheduleResult = await evaluateReschedulePolicy(db, {
        organizationId: org.id,
        conversationId,
      });

      if (rescheduleResult.success) {
        const evaluation = rescheduleResult.data;

        if (evaluation.reason === 'external_provider') {
          // External provider: hand off to agent
          response.action = 'handoff';
          response.silentHandoffReason = `Client wants to reschedule appointment "${evaluation.appointmentTitle}" but it is managed through an external booking system. Please assist with rescheduling.`;
          response.message = evaluation.contextMessage;
          response.rescheduleAppointment = undefined;
        } else {
          const reschedulePrompt = `${userPrompt}

--- Reschedule Policy Result ---
${evaluation.contextMessage}
${evaluation.appointmentId ? `Appointment ID: ${evaluation.appointmentId}` : ''}
${evaluation.eligible ? 'The client IS eligible to reschedule.' : `Reschedule NOT allowed. Reason: ${evaluation.reason}`}

Now respond to the customer based on the reschedule policy result above. If they can reschedule, offer the available slots. If they cannot, explain the policy. Remember to respond in the required JSON format.`;

          const rescheduleAIResult = await chatCompletion(reschedulePrompt, {
            systemMessage: enhancedSystemPrompt,
            maxTokens: AI_MAX_TOKENS,
            jsonResponse: true,
          });

          response = parseAIResponse(
            rescheduleAIResult.content,
            conversationId
          );
          response.rescheduleAppointment = undefined;
        }
      }
    } catch {
      calendarLogger.warn('Reschedule policy evaluation failed', {
        conversationId,
      });
    }
  }

  // 13. Handle reschedule confirmation (client picked a slot)
  if (calendarConnected && response.confirmReschedule?.appointmentId) {
    try {
      const { appointmentId, newDate, newTime } = response.confirmReschedule;
      calendarLogger.info('AI confirmed reschedule', {
        conversationId,
        appointmentId,
        newDate,
        newTime,
      });

      // The client picks a wall-clock time; interpret newDate/newTime IN THE
      // ORG'S TIMEZONE and convert to the stored UTC instant (appointment
      // columns are timestamptz). Using new Date(`${newDate}T${newTime}`) would
      // wrongly anchor it to the SERVER's timezone.
      const [h, mi] = newTime.split(':').map(Number);
      const startDate = zonedWallTimeToUtc(newDate, h * 60 + mi, org.timezone);
      const endDate = new Date(startDate);
      endDate.setMinutes(
        endDate.getMinutes() + (org.defaultAppointmentDuration ?? 30)
      );

      const updateResult = await updateAppointment(db, {
        id: appointmentId,
        organizationId: org.id,
        startDate,
        endDate,
        sendRescheduleEmail: true,
        rescheduleMessage: 'Your appointment has been rescheduled.',
      });

      // Format the confirmed time back in the ORG'S timezone so we tell the
      // client the correct local time, not the server's.
      const formattedWhen = startDate.toLocaleString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: org.timezone,
      });

      let confirmationContext: string;
      if (updateResult.success) {
        confirmationContext = `The appointment has been successfully rescheduled to ${formattedWhen}. A confirmation email has been sent.`;
      } else if (updateResult.error.code === ErrorCodes.CONFLICT) {
        // The chosen slot was taken between offering it and confirming (the
        // DB's no-overlap constraint rejected the move). Re-offer fresh slots
        // instead of dead-ending the client into "call the clinic".
        const reEval = await evaluateReschedulePolicy(db, {
          organizationId: org.id,
          conversationId,
        });
        confirmationContext =
          reEval.success && reEval.data.eligible
            ? `That time slot was just taken by someone else. ${reEval.data.contextMessage}`
            : 'That time slot was just taken by someone else and I could not find another one right now. Please ask the client to suggest a different day.';
      } else {
        confirmationContext =
          'Failed to reschedule the appointment. Please ask the client to contact the clinic directly.';
      }

      const confirmPrompt = `${userPrompt}

--- Reschedule Confirmation ---
${confirmationContext}

Now confirm the reschedule to the customer. Remember to respond in the required JSON format.`;

      const confirmAIResult = await chatCompletion(confirmPrompt, {
        systemMessage: enhancedSystemPrompt,
        maxTokens: AI_MAX_TOKENS,
        jsonResponse: true,
      });

      response = parseAIResponse(confirmAIResult.content, conversationId);
      response.confirmReschedule = undefined;
    } catch {
      calendarLogger.warn('Reschedule confirmation failed', {
        conversationId,
      });
    }
  }

  return ok(response);
};

export const generateAIResponse = (
  db: DbConnection,
  input: GenerateAIResponseInput,
  apiKey: string
) =>
  trackedResult(
    'chatbots.generateAIResponse',
    () => generateAIResponseImpl(db, input, apiKey),
    {
      properties: {
        conversationId: input.conversationId,
      },
    }
  );

export type GenerateAIResponseResult = Awaited<
  ReturnType<typeof generateAIResponse>
>;
