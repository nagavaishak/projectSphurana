import type {
  ChatbotSettings,
  ConversationMetadata,
} from '@borradh-workspace/database';
import {
  canResolveAvailability,
  nativeBookingLink,
  usesNativeCalendar,
} from '../../../shared/index.js';
import {
  type VoiceExample,
  buildBorradhSystemPrompt,
  buildConversationContext,
} from './borradh-prompt-builder.js';
import type { ReturningSenderContext } from './conversation-context-builder.js';
import { buildCurrentDateLine } from './current-date.js';
import type { ResolvedService } from './resolve-organization-services.js';

/**
 * Format conversation history for the LLM context.
 */
function formatHistory(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => {
      const role =
        m.role === 'user'
          ? 'Customer'
          : m.role === 'agent'
            ? 'Human Agent'
            : 'Assistant';
      return `${role}: ${m.content}`;
    })
    .join('\n');
}

export interface BuildPromptContextInput {
  organization: {
    id: string;
    name: string;
    slug: string | null;
    defaultBookingLink: string | null;
    businessType: string | null;
    tagline: string | null;
    credibilityLine: string | null;
    businessHours: Record<number, { from: number; to: number }> | null;
    websiteUrl: string | null;
    primaryCalendarType: string | null;
    primaryCalendarAccountId: string | null;
    /** Where this org takes bookings. Field of record (ENG-500). */
    bookingDestination?: string | null;
    /**
     * IANA zone the clinic operates in. Anchors "today" in the prompt so the
     * model can order the dates the customer and the operator's directive
     * mention — without it every date is an unanchored string.
     */
    timezone: string;
    chatbotSettings: unknown;
    chatbotSystemPrompt: string | null;
    knowledgeBase: unknown;
  };
  /**
   * The org's LIVE primary custom domain, or null for the path tier. Resolved
   * by the caller (`resolveMicrositeLinkTarget`) so this stays a pure,
   * synchronous function. Required rather than optional: defaulting to our own
   * host is the ENG-770 failure mode.
   */
  micrositePrimaryDomain: string | null;
  services: ResolvedService[];
  locations: {
    name: string | null;
    addressLine1: string;
    addressLine2: string | null;
    city: string;
    county: string | null;
    postalCode: string | null;
    country: string;
  }[];
  /**
   * The branch this conversation is about, when known. Names the branch the
   * prices belong to so the model cannot present them as org-wide.
   */
  activeLocationName?: string | null;
  /**
   * That same branch as a URL segment (`slug ?? id`), so the native booking
   * link Claire sends names the branch whose prices she just quoted. Null when
   * `resolveConversationBranch` named none, which yields the un-branched entry
   * link on purpose.
   */
  branchSegment?: string | null;
  conversationMetadata: ConversationMetadata | null;
  isReturningConversation: boolean;
  returningSender?: ReturningSenderContext | null;
  messageHistory: { role: string; content: string }[];
  userMessage: string;
  /**
   * What the customer originally enquired about via a Meta lead form (form
   * answers + mapped service). Surfaced so the bot knows the service even when
   * the ad/referral carries none.
   */
  leadEnquiry?: string;
  /** Learned voice style profile text. When provided, replaces the default style rules. */
  voiceStyleProfile?: string;
  /** Real conversation examples for voice-cloned style matching. */
  voiceExamples?: VoiceExample[];
}

export interface PromptContext {
  systemPrompt: string;
  userPrompt: string;
  calendarConnected: boolean;
}

/**
 * Build the full prompt context (system prompt + user prompt) for the AI chatbot.
 * Combines the Borradh system prompt, conversation context, history, and user message.
 */
export function buildPromptContext(
  input: BuildPromptContextInput
): PromptContext {
  const {
    organization: org,
    activeLocationName,
    micrositePrimaryDomain,
    services,
    locations,
    conversationMetadata,
    isReturningConversation,
    returningSender,
    messageHistory,
    userMessage,
    leadEnquiry,
    voiceStyleProfile,
    voiceExamples,
    branchSegment,
  } = input;

  const chatbotSettings =
    (org.chatbotSettings as ChatbotSettings | null) ?? null;
  const calendarConnected = canResolveAvailability(org);

  // Derive booking link from primaryCalendarType:
  // - native ('borradh'): ONLY ever the Borradh booking page, or nothing.
  // - anything else (or null): the org's defaultBookingLink (external system)
  //
  // A native org may still carry a defaultBookingLink left over from a previous
  // external setup. Falling back to it (which happened whenever the slug or web
  // url was missing) would send customers into a booking system that our
  // in-chat flow, availability checks and reminders know nothing about, causing
  // double bookings and appointments the clinic never sees in Borradh. When the
  // native link can't be built we deliberately surface no link at all.
  const effectiveBookingLink = usesNativeCalendar(org)
    ? nativeBookingLink(org, micrositePrimaryDomain, branchSegment)
    : org.defaultBookingLink;

  // Anchor "today" ahead of everything else in the system prompt. It has to
  // precede the operator's free-text directive: that directive is where the
  // unanchored dates come from ("no availability until September 2nd"), and
  // the model needs the anchor in hand before it reads them.
  const currentDateLine = buildCurrentDateLine(org.timezone);

  const basePrompt = buildBorradhSystemPrompt({
    organizationName: org.name,
    chatbotSettings,
    services,
    defaultBookingLink: effectiveBookingLink,
    businessType: org.businessType,
    tagline: org.tagline,
    credibilityLine: org.credibilityLine,
    businessHours: org.businessHours,
    activeLocationName,
    locations,
    websiteUrl: org.websiteUrl,
    knowledgeBase: org.knowledgeBase,
    customSystemPrompt: org.chatbotSystemPrompt,
    conversationMetadata,
    calendarConnected,
    isReturningConversation,
    voiceStyleProfile,
    voiceExamples,
  });

  const systemPrompt = `${currentDateLine}\n${basePrompt}`;

  // Build user prompt with history + conversation context
  const historyText = formatHistory(messageHistory);
  const conversationContext = buildConversationContext(
    conversationMetadata,
    returningSender
  );

  let userPrompt = '';
  if (conversationContext) {
    userPrompt += conversationContext;
  }
  if (leadEnquiry) {
    userPrompt += `\n--- Lead Form Enquiry ---\n${leadEnquiry}\n`;
  }
  if (historyText) {
    userPrompt += `${historyText}\nCustomer: ${userMessage}`;
  } else {
    userPrompt += `Customer: ${userMessage}`;
  }

  return { systemPrompt, userPrompt, calendarConnected };
}
