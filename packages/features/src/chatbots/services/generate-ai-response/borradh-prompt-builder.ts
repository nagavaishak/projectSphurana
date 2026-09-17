import type {
  ConversationMetadata,
  ToneRegion,
} from '@borradh-workspace/database';

import {
  APPROVED_PHRASES,
  BORRADH_BEHAVIORAL_PROMPT,
  BORRADH_DEFAULT_STYLE_PROMPT,
  BORRADH_VOICE_CLONED_STYLE_PROMPT,
  CALENDAR_INSTRUCTIONS,
  CALENDAR_RESPONSE_FIELDS,
  FIRST_MESSAGE_RULES,
  NO_CALENDAR_BOOKING_LINK_NO_DEPOSIT,
  NO_CALENDAR_NO_LINK,
  RETURNING_CONVERSATION_RULES,
  TONE_REGION_RULES,
} from './prompt-templates.js';

import {
  type ClinicDataParams,
  buildClinicData,
  buildConsultationPhrases,
  buildTreatmentResultsSection,
  isConsultationFree,
} from './clinic-data-builder.js';

// Re-export for backwards compatibility
export { buildConversationContext } from './conversation-context-builder.js';

// =============================================================================
// VOICE CLONING TYPES
// =============================================================================

export interface VoiceExample {
  customerMessage: string;
  businessReply: string;
}

// =============================================================================
// MAIN BUILDER: COMBINES LAYER 1 + LAYER 2
// =============================================================================

export interface BuildBorradhPromptParams extends ClinicDataParams {
  conversationMetadata?: ConversationMetadata | null;
  isReturningConversation?: boolean;
  /** Learned voice style profile text. When provided, replaces the default style rules. */
  voiceStyleProfile?: string;
  /** Real conversation examples for voice-cloned style matching. */
  voiceExamples?: VoiceExample[];
}

export function buildBorradhSystemPrompt(
  params: BuildBorradhPromptParams
): string {
  const { chatbotSettings, organizationName } = params;

  const botName = chatbotSettings?.ownerName ?? 'Claire';
  const ownerName = chatbotSettings?.ownerName ?? organizationName;
  const toneRegion: ToneRegion = chatbotSettings?.toneRegion ?? 'ie';
  const calendarConnected =
    params.calendarConnected ?? chatbotSettings?.calendarConnected ?? false;

  // Determine booking method instructions
  let bookingMethodInstructions: string;
  if (calendarConnected) {
    bookingMethodInstructions =
      'When ready to book: Use the checkAvailability tool to find real slots. Ask for their preferred day first, then offer 2-3 specific times. NEVER invent times.';
  } else if (params.defaultBookingLink) {
    // One template. There is no longer a separate deposit link to hand out —
    // any deposit is collected by the booking page itself, so pointing the
    // customer there covers both cases.
    bookingMethodInstructions = NO_CALENDAR_BOOKING_LINK_NO_DEPOSIT.replace(
      /\{\{booking_link\}\}/g,
      params.defaultBookingLink
    ).replace(/\{\{owner_name\}\}/g, ownerName);
  } else {
    bookingMethodInstructions = NO_CALENDAR_NO_LINK.replace(
      /\{\{owner_name\}\}/g,
      ownerName
    );
  }

  // Escalation contact
  const escalationParts: string[] = [];
  if (chatbotSettings?.escalationEmail)
    escalationParts.push(chatbotSettings.escalationEmail);
  if (chatbotSettings?.escalationPhone)
    escalationParts.push(chatbotSettings.escalationPhone);
  const escalationContact =
    escalationParts.length > 0
      ? escalationParts.join(' or ')
      : 'the team directly';

  // Build consultation phrases based on service data
  const consultFree = isConsultationFree(chatbotSettings, params.services);
  const consultPhrases = buildConsultationPhrases(
    consultFree,
    ownerName,
    params.services
  );

  // Build treatment results section
  const treatmentResultsSection = buildTreatmentResultsSection(
    chatbotSettings?.treatmentResults
  );

  // Determine first message vs returning conversation rules
  const firstMessageSection = params.isReturningConversation
    ? RETURNING_CONVERSATION_RULES
    : FIRST_MESSAGE_RULES;

  // Build the style section based on whether voice cloning is active
  const styleSection = buildStyleSection(params, toneRegion);

  // Custom directive — placed at the VERY TOP so it has highest priority
  let prompt = '';
  if (params.customSystemPrompt) {
    prompt += `=== CUSTOM DIRECTIVE (HIGHEST PRIORITY — OVERRIDES ALL OTHER RULES) ===\nThe clinic owner has set the following custom instructions. These OVERRIDE any conflicting rules below, including formatting rules, tone rules, and message length rules. Follow these instructions exactly, even if they contradict the default behaviour.\n\nWhen you repeat a fact from this directive, repeat its conditions with it. Any day, eligibility, limit or qualifier attached to a price, an offer or a claim here is part of that fact, not an optional detail. Dropping it tells the customer something the owner did not say.\n\n${params.customSystemPrompt}\n\n=== END CUSTOM DIRECTIVE ===\n\n`;
  }

  // Layer 1: Behavioral prompt with style section injected
  prompt += BORRADH_BEHAVIORAL_PROMPT.replace(
    /\{\{STYLE_SECTION\}\}/g,
    styleSection
  )
    .replace(/\{\{first_message_section\}\}/g, firstMessageSection)
    .replace(/\{\{bot_name\}\}/g, botName)
    .replace(/\{\{bot_name_lower\}\}/g, botName.toLowerCase())
    .replace(/\{\{clinic_name\}\}/g, organizationName)
    .replace(/\{\{owner_name\}\}/g, ownerName)
    .replace(
      /\{\{owner_credentials\}\}/g,
      chatbotSettings?.ownerCredentials ?? 'fully qualified'
    )
    .replace(/\{\{tone_region_rules\}\}/g, TONE_REGION_RULES[toneRegion])
    .replace(/\{\{approved_phrases\}\}/g, APPROVED_PHRASES[toneRegion])
    .replace(
      /\{\{customer_name\}\}/g,
      params.conversationMetadata?.name?.split(/\s+/)[0] ?? 'there'
    )
    .replace(/\{\{booking_method_instructions\}\}/g, bookingMethodInstructions)
    .replace(/\{\{escalation_contact\}\}/g, escalationContact)
    .replace(
      /\{\{gallery_link\}\}/g,
      chatbotSettings?.galleryLink ?? 'our gallery'
    )
    .replace(
      /\{\{instagram_link\}\}/g,
      chatbotSettings?.instagramLink ?? 'our Instagram'
    )
    .replace(
      /\{\{reviews_link\}\}/g,
      chatbotSettings?.reviewsLink ?? 'our reviews'
    )
    .replace(/\{\{booking_link\}\}/g, params.defaultBookingLink ?? '')
    .replace(/\{\{consultation_rule\}\}/g, consultPhrases.rule)
    .replace(/\{\{consultation_article\}\}/g, consultPhrases.article)
    .replace(/\{\{consultation_qualifier\}\}/g, consultPhrases.qualifier)
    .replace(
      /\{\{consultation_objection_line\}\}/g,
      consultPhrases.objectionLine
    )
    .replace(/\{\{consultation_health_line\}\}/g, consultPhrases.healthLine)
    .replace(/\{\{treatment_results_section\}\}/g, treatmentResultsSection)
    .replace(
      /\{\{calendar_response_fields\}\}/g,
      calendarConnected ? CALENDAR_RESPONSE_FIELDS : ''
    );

  // Add calendar instructions if connected
  if (calendarConnected) {
    prompt += CALENDAR_INSTRUCTIONS.replace(/\{\{owner_name\}\}/g, ownerName);
  }

  // Layer 2: Clinic data
  prompt += buildClinicData(params);

  return prompt;
}

// =============================================================================
// STYLE SECTION BUILDER
// =============================================================================

/**
 * Builds the style section that gets injected into {{STYLE_SECTION}}.
 *
 * When voiceStyleProfile is provided, uses the voice-cloned template.
 * Otherwise, uses the compact default style.
 */
function buildStyleSection(
  params: BuildBorradhPromptParams,
  _toneRegion: ToneRegion
): string {
  if (params.voiceStyleProfile) {
    // Voice cloning is active — use learned style
    const formattedExamples = formatVoiceExamples(params.voiceExamples ?? []);

    return BORRADH_VOICE_CLONED_STYLE_PROMPT.replace(
      /\{\{voiceStyleProfile\}\}/g,
      params.voiceStyleProfile
    ).replace(/\{\{voiceExamples\}\}/g, formattedExamples);
  }

  // No voice profile — use default style (produces identical output to original)
  return BORRADH_DEFAULT_STYLE_PROMPT;
}

/**
 * Formats voice examples into a readable format for the prompt.
 */
function formatVoiceExamples(examples: VoiceExample[]): string {
  if (examples.length === 0) {
    return 'No examples available yet.';
  }

  return examples
    .map(
      (ex) =>
        `Customer: "${ex.customerMessage}"\nYour reply: "${ex.businessReply}"`
    )
    .join('\n\n');
}
