/**
 * Post-processor for chatbot outbound messages.
 * Applied to every AI-generated message before delivery.
 *
 * Filters:
 * 1. Markdown stripping (links, bold, italic)
 * 2. Dash stripping (em-dashes, en-dashes used as punctuation)
 * 3. Banned phrase removal
 * 4. Hallucination guards (fake bookings, invented times)
 * 5. Exclamation mark reduction
 * 6. Cleanup (double spaces, orphaned punctuation)
 */

import { createLogger, redactPII } from '@borradh-workspace/observability';

const logger = createLogger('PostProcessor');

// =============================================================================
// BANNED PHRASES
// =============================================================================

const BANNED_PHRASES = [
  'I completely understand',
  'I understand your concern',
  "I'd be happy to help",
  "That's a great question",
  'Absolutely!',
  'Thank you for reaching out',
  'I hope this helps',
  "Don't hesitate to",
  'Feel free to',
  'I appreciate your patience',
  'Rest assured',
  "Please don't hesitate",
  'At your earliest convenience',
  'Moving forward',
  'Certainly!',
  'Indeed',
  'I want to assure you',
  'Thank you for your interest',
  'Kindly',
  'Let me assist you',
  'Have a wonderful day',
  'How may I help you today?',
  'What can I help you with today?',
  "I'd love to help",
  'That sounds great!',
  "That's wonderful!",
  "That's fantastic!",
];

// =============================================================================
// HALLUCINATION PATTERNS
// =============================================================================

const HALLUCINATION_PATTERNS = [
  // Fake booking confirmations.
  //
  // These are deliberately wider than the noun phrases they started as. The
  // originals required the word "appointment" or "booking" to follow "your"
  // immediately, so "your Botox appointment is booked for Thursday" — a flat
  // untrue confirmation, observed verbatim in local verification against an
  // org that books elsewhere — matched none of them. Any treatment name in
  // the middle was enough to walk straight through the guard.
  //
  // Widening is safe because the guard is skipped outright once the
  // conversation HAS a booking (`calendarActionConfirmed`), so the real
  // confirmation ("You're all booked for …") still ships intact.
  /you(?:'re| are) (?:all )?booked\b/i,
  /(?:I've|I have|we've|we have) (?:booked|scheduled|reserved|secured) (?:you|your|that|it)/i,
  /(?:appointment|booking|slot|spot) (?:is|has been) (?:booked|confirmed|scheduled|secured|reserved|set)\b/i,
  /your (?:appointment|booking) (?:is |has been )?confirmed/i,
  // Fake cancellations
  /(?:I've|I have|we've|we have) cancelled/i,
  /(?:your |the )?(?:appointment|booking) (?:is |has been )?cancelled/i,
];

/**
 * Claims that a booking action is UNDERWAY or is COMING — "I'm arranging that
 * now", "I'll confirm once it's processed".
 *
 * These are guarded on exactly the same condition as the completed claims
 * above, and for the same reason: booking is synchronous. `bookAppointment`
 * either writes an `appointment` row and returns, or it fails. There is no
 * queue, no deferred write, and nothing that could later "process" and produce
 * the promised confirmation — so a message describing a pending booking
 * describes a path that does not exist.
 *
 * Kept separate from HALLUCINATION_PATTERNS only for readability; both lists
 * run together. Split out from a real production exchange (ENG-815) where the
 * customer asked "is it booked?" and was told "I'll confirm it once it's
 * processed", which is worse than the completed-tense lie the old list caught:
 * a customer told it is booked may check, a customer told it is processing
 * will wait.
 */
const BOOKING_IN_PROGRESS_PATTERNS = [
  // "I'm arranging / booking / scheduling / sorting that (for you) now"
  /(?:I'm|I am|we're|we are) (?:just |currently |now )?(?:arranging|booking|scheduling|setting up|sorting|putting) (?:you |your |that |this |it |the )/i,
  // "I'm getting you booked in now".
  //
  // Deliberately anchored on the first person progressive. "Shall I get you
  // booked in?" is an offer, not a claim, and stripping offers would cost
  // bookings — that language is handled by the sales cap, not here.
  /(?:I'm|I am|we're|we are) (?:just |currently |now )?getting (?:you|that|this|it) (?:booked|scheduled|arranged|sorted)/i,
  // "your appointment is being arranged / is being processed / is in progress"
  /(?:is|are) (?:being |getting )(?:arranged|booked|processed|confirmed|sorted|set up)/i,
  /(?:booking|appointment) is (?:in progress|pending|processing)/i,
  // "I'll confirm once it's processed", "I'll let you know when it's booked".
  //
  // The trailing "once / when / as soon as" is required: it is what turns a
  // reply into a promise of a callback the bot cannot make. Without it this
  // would also strip honest sentences like "I'll let you know about our
  // October offer", which the bot CAN honour on the next message.
  /(?:I'll|I will|we'll|we will) (?:confirm|let you know|come back to you|get back to you|update you)[^.!?]*\b(?:once|when|as soon as|after)\b/i,
  // "I'll confirm your appointment", "I'll secure that slot for you"
  /(?:I'll|I will|we'll|we will) (?:confirm|secure|reserve|lock in) (?:your|the|that) (?:appointment|booking|slot|spot|time)/i,
  /once (?:it'?s|that'?s|this is) (?:processed|confirmed|booked|gone through|sorted|done)/i,
  // "I'm checking that for you now" — a claim to be performing a lookup that
  // is not happening. The availability tool runs BEFORE the visible reply is
  // produced, so a shipped message can never be waiting on one.
  /(?:I'm|I am|we're|we are) (?:just |currently |now )?(?:checking|looking into|confirming|verifying) (?:that|this|it|your)\b/i,
  // "I've put that through", "I've sent that through to the diary"
  /(?:I've|I have|we've|we have) (?:put|sent|pushed) (?:that|this|it|you) through/i,
  // "I'll get that arranged for you", "let me get that sorted".
  //
  // The future form is the one that actually shipped in local verification
  // against an org whose diary lives in another system: the booking was
  // correctly refused, and the model still promised the booking in the future
  // tense. Guarding only the progressive form ("I'm arranging") left the
  // commonest phrasing of the same lie untouched.
  /(?:I'll|I will|we'll|we will|let me) (?:get|have) (?:you|that|this|it|your [a-z]+) (?:arranged|booked|scheduled|sorted|set up|confirmed|put through)/i,
  // "I'll book you in", "I'll pencil you down"
  /(?:I'll|I will|we'll|we will) (?:book|pencil|pop|put) you (?:in|down)/i,
];

/**
 * Patterns that indicate fake availability claims.
 * Only stripped when calendarConnected is explicitly false.
 */
const FAKE_AVAILABILITY_PATTERNS = [
  /(?:we(?:'ve| have)|I(?:'ve| have)) got (?:a (?:few )?|an |some )?(?:slots?|openings?|availability|appointments?)|(?:we|I) (?:have|got) (?:a (?:few )?|an |some )?(?:slots?|openings?|availability|appointments?)/i,
  /(?:I've|I have|we've|we have) (?:noted|pencilled|penciled|written|put) you (?:down|in)/i,
  /(?:let me |I'll |I can )(?:check|look at|pull up|have a look at) (?:the |our )?(?:availability|calendar|schedule|diary)/i,
  /(?:you're|you are) (?:all )?(?:set|scheduled|down) for/i,
  /(?:I've|I have) (?:checked|looked) (?:and |the )?(?:we|our)/i,
];

// =============================================================================
// SALES ATTEMPT PATTERNS — hard cap enforcement
// =============================================================================

/**
 * Patterns that constitute a sales attempt (a "close").
 * Sales attempt = offering times / asking to come in / pushing a booking.
 * Sending the booking link is also a sales attempt but matched separately by URL.
 *
 * These are stripped from messages when the conversation has already used its
 * 2 sales attempts (combined cap across offers + link sends).
 */
const SALES_ATTEMPT_PATTERNS = [
  // Offer to send/check/share availability or times
  /\bwant me to (send|check|share|pop|grab|find|pull up)(\s+you)?(\s+(some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free|\s+availability|\s+through)/i,
  /\bwould you like me to (send|check|share|pop|grab|find)(\s+you)?(\s+(some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free|\s+availability)/i,
  /\bwill i (send|share|pop|grab|find|pull up)(\s+you)?(\s+(some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free)/i,
  /\b(shall|can) i (send|share|pop|grab|find|pull up)(\s+you)?(\s+(some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free)/i,
  /\bi can (send|share|grab|pull up|pop over)(\s+you)?(\s+(what we have|some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free|\s+if you like)/i,
  /\blet me (send|share|check|pull up|grab|pop over)(\s+you)?(\s+(some|a few|the))?(\s+times|\s+slots|\s+what'?s|\s+free)/i,

  // Coming in / booking
  /\b(would you like to|want to|fancy|why not) (come in|book|pop in|book in|pop down|come down|pop over)/i,
  /\b(come in|pop in|pop down) (for|to have) (a|an|some)?\s?(chat|consultation|consult|appointment|look|free consultation)/i,
  /\b(get|book|pencil|put|pop) you (in|booked|down)\b/i,
  /\b(shall|can|should|may) i (get|book|put|pencil|pop) you (in|down|booked)/i,
  /\b(we can|let's|let me) (get|book) you (in|booked)/i,

  // Timing / scheduling close
  /\bwhen (were|are|would) you (thinking|free|wanting|hoping|like to)/i,
  /\bwhen (suits|works) (best )?(for )?you/i,
  /\bwhat (day|time|date) (suits|works) (best )?(for )?you/i,

  // Direct binary close
  /\bwould you like (a|an|to book)\s?(consultation|appointment|booking|chat)/i,
];

/**
 * Detect whether a message contains a sales attempt.
 * Exported for use in conversation-flow counting.
 */
export function containsSalesAttempt(text: string): boolean {
  return SALES_ATTEMPT_PATTERNS.some((p) => p.test(text));
}

/**
 * Strip excess sales attempts from a message when the conversation has
 * already hit the 2-sales-attempt cap. Also strips the booking link URL
 * if it has already been sent in this conversation (to prevent re-sends
 * on repeated "send me the link" type messages).
 *
 * This is a HARD cap — enforced in code regardless of what the LLM produced.
 * The prompt encourages the cap; this function guarantees it.
 */
function stripExcessSalesAttempts(
  text: string,
  options: PostProcessOptions
): string {
  const pushCount = options.bookingPushCount ?? 0;
  const linkAlreadySent = options.bookingLinkSent ?? false;
  const link = options.bookingLink;
  const atCap = pushCount >= 2;

  let result = text;

  // 1. If at cap, strip any sentence containing a sales-attempt pattern.
  if (atCap) {
    for (const pattern of SALES_ATTEMPT_PATTERNS) {
      if (pattern.test(result)) {
        const sentences = result.split(/(?<=[.!?])\s+/);
        const filtered = sentences.filter((s) => !pattern.test(s));
        result = filtered.join(' ');
      }
    }
  }

  // 2. If the booking link was already sent, strip any sentence that
  //    re-includes the URL. This is also a sales attempt (same cap).
  //    When the cap is reached AND the link's been sent, the model must
  //    not produce another URL even on explicit asks.
  if (link && (atCap || linkAlreadySent)) {
    // Escape the URL for regex use
    const escapedLink = link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const linkPattern = new RegExp(escapedLink, 'i');
    if (linkPattern.test(result)) {
      const sentences = result.split(/(?<=[.!?])\s+/);
      const filtered = sentences.filter((s) => !linkPattern.test(s));
      result = filtered.join(' ');
    }
  }

  return result;
}

// =============================================================================
// PROCESSORS
// =============================================================================

/**
 * Replace em-dashes and en-dashes used as punctuation with commas or periods.
 */
function stripDashes(text: string): string {
  // Replace " — " or " – " (surrounded by spaces) with comma+space
  let result = text.replace(/\s[—–]\s/g, ', ');

  // Replace "—" or "–" at start of sentence or after period with nothing
  result = result.replace(/(?:^|[.!?]\s*)[—–]\s*/g, (match) => {
    // Keep the sentence-ending punctuation if present
    const leadingPunct = match.match(/^[.!?]/)?.[0];
    return leadingPunct ? `${leadingPunct} ` : '';
  });

  // Replace remaining standalone dashes used as punctuation (not in URLs or numbers)
  // Only target dashes that are preceded/followed by letters (punctuation use)
  result = result.replace(/(\w)\s*[—–]\s*(\w)/g, '$1, $2');

  return result;
}

/**
 * Remove or rewrite banned phrases that slipped through the AI prompt.
 */
function removeBannedPhrases(text: string): string {
  let result = text;
  for (const phrase of BANNED_PHRASES) {
    // Case-insensitive replacement, preserving surrounding text
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escaped, 'gi');
    result = result.replace(regex, '');
  }
  return result;
}

/**
 * Block hallucinated booking confirmations and cancellations.
 * Returns the original message with offending sentences removed.
 */
function guardHallucinations(
  text: string,
  options: PostProcessOptions
): string {
  if (options.calendarActionConfirmed) {
    // If a real calendar action was confirmed, allow booking language
    return text;
  }

  let result = text;
  // Completed claims ("you're booked in") and in-flight ones ("I'm arranging
  // that now") are guarded together: both assert a booking that no row backs.
  for (const pattern of [
    ...HALLUCINATION_PATTERNS,
    ...BOOKING_IN_PROGRESS_PATTERNS,
  ]) {
    if (pattern.test(result)) {
      // Remove the offending sentence
      // Split by sentence boundaries, filter out matches
      const sentences = result.split(/(?<=[.!?])\s+/);
      const filtered = sentences.filter((s) => !pattern.test(s));
      result = filtered.join(' ');
    }
  }

  // Strip fake availability claims when no calendar is connected
  if (options.calendarConnected === false) {
    for (const pattern of FAKE_AVAILABILITY_PATTERNS) {
      if (pattern.test(result)) {
        const sentences = result.split(/(?<=[.!?])\s+/);
        const filtered = sentences.filter((s) => !pattern.test(s));
        result = filtered.join(' ');
      }
    }
  }

  return result;
}

/**
 * Cap exclamation marks to max 2 per message (across all bubbles).
 * Replace excess `!` with `.` to maintain sentence endings.
 */
function reduceExclamationMarks(text: string, max = 2): string {
  let count = 0;
  return text.replace(/!/g, () => {
    count++;
    return count <= max ? '!' : '.';
  });
}

/**
 * Strip markdown formatting that the AI may produce despite prompt instructions.
 * Converts [text](url) → url, removes **bold** and *italic* markers.
 */
function stripMarkdown(text: string): string {
  let result = text;

  // Convert markdown links [text](url) → just the url
  result = result.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, '$2');

  // Remove bold markers **text** → text
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');

  // Remove italic markers *text* → text (but not inside URLs)
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');

  return result;
}

/**
 * Clean up artifacts: double spaces, orphaned punctuation, leading/trailing whitespace.
 */
function cleanup(text: string): string {
  let result = text;

  // Fix double spaces
  result = result.replace(/\s{2,}/g, ' ');

  // Fix double commas
  result = result.replace(/,\s*,/g, ',');

  // Fix comma followed by period
  result = result.replace(/,\s*\./g, '.');

  // Fix space before punctuation
  result = result.replace(/\s+([.!?,])/g, '$1');

  // Fix orphaned punctuation at start
  result = result.replace(/^[,.\s]+/, '');

  // Trim each line
  result = result
    .split('\n')
    .map((line) => line.trim())
    .join('\n');

  return result.trim();
}

// =============================================================================
// PUBLIC API
// =============================================================================

export interface PostProcessOptions {
  /** Whether a real calendar booking action was confirmed by the system */
  calendarActionConfirmed?: boolean;
  /** Whether the org has a calendar integration connected */
  calendarConnected?: boolean;
  /**
   * Sales attempts (offers + link sends) already made in this conversation
   * BEFORE this message. Used to enforce the 2-attempt hard cap. When at 2,
   * any sales-attempt language in the new message is stripped.
   */
  bookingPushCount?: number;
  /**
   * Whether the booking link has already been sent in this conversation.
   * When true, the URL is stripped from this message even if the cap isn't
   * fully reached — the link is a sales attempt and shouldn't be re-sent.
   */
  bookingLinkSent?: boolean;
  /**
   * The clinic's booking link URL — used to detect and strip re-sends.
   * Required for booking-link enforcement; without it the URL-stripping
   * step is a no-op.
   */
  bookingLink?: string;
  /**
   * Conversation ID for diagnostic logs. Optional — when set, the
   * post-processor logs before/after state when it modifies a message
   * (so we can attribute "bot went silent" cases to the right filter).
   */
  conversationId?: string;
}

/**
 * Post-process an AI-generated message before delivery.
 * Applies all filters in sequence.
 */
export function postProcessMessage(
  text: string,
  options: PostProcessOptions = {}
): string {
  if (!text || text.trim().length === 0) return text;

  const originalText = text;
  let result = text;

  // 1. Strip markdown formatting (links, bold, italic)
  result = stripMarkdown(result);

  // 2. Strip dashes
  result = stripDashes(result);

  // 3. Remove banned phrases
  result = removeBannedPhrases(result);

  // 4. Guard hallucinations
  result = guardHallucinations(result, options);

  // 5. Hard-cap sales attempts (strips offers/link re-sends when over cap)
  result = stripExcessSalesAttempts(result, options);

  // 6. Reduce exclamation marks (max 2 per message)
  result = reduceExclamationMarks(result);

  // 7. Cleanup
  result = cleanup(result);

  // Diagnostics: warn loudly when the filter chain stripped a non-empty
  // message down to empty — this is the most common "bot went silent"
  // surface. Info-level for benign shortening cases.
  if (!result.trim() && originalText.trim()) {
    logger.warn('Post-processor stripped message to empty', {
      reason: 'post_processor_stripped_all',
      conversationId: options.conversationId,
      debug: {
        originalLength: originalText.length,
        originalPreview: redactPII(originalText).slice(0, 500),
        bookingPushCount: options.bookingPushCount ?? 0,
        bookingLinkSent: options.bookingLinkSent ?? false,
        calendarConnected: options.calendarConnected ?? false,
      },
    });
  } else if (
    options.conversationId &&
    result !== originalText &&
    result.length < originalText.length * 0.8
  ) {
    // Significant shortening — likely a filter stripped real content
    logger.info('Post-processor shortened message significantly', {
      reason: 'post_processor_shortened',
      conversationId: options.conversationId,
      debug: {
        before: redactPII(originalText).slice(0, 500),
        after: redactPII(result).slice(0, 500),
        originalLength: originalText.length,
        finalLength: result.length,
        bookingPushCount: options.bookingPushCount ?? 0,
        bookingLinkSent: options.bookingLinkSent ?? false,
      },
    });
  }

  return result;
}
