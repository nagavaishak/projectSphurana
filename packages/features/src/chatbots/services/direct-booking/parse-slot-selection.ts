import { trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ParseSlotSelectionInput,
  type ParseSlotSelectionResult,
  parseSlotSelectionSchema,
} from './direct-booking.schema.js';

/**
 * Day name patterns for matching
 */
const DAY_PATTERNS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  thursday: 4,
  thu: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

/**
 * Ordinal patterns for matching "the first one", "second option", etc.
 */
const ORDINAL_PATTERNS: Array<{ patterns: string[]; index: number }> = [
  {
    patterns: ['first', '1st', 'first one', 'first option', 'option 1', '#1'],
    index: 0,
  },
  {
    patterns: [
      'second',
      '2nd',
      'second one',
      'second option',
      'option 2',
      '#2',
    ],
    index: 1,
  },
  {
    patterns: ['third', '3rd', 'third one', 'third option', 'option 3', '#3'],
    index: 2,
  },
  {
    patterns: ['last', 'last one', 'last option', 'final', 'final one'],
    index: -1,
  },
];

/**
 * Parse time from user message (e.g., "2pm", "2:30", "14:00", "2 pm")
 * Returns [hour, minute] or null
 */
function parseTimeFromMessage(message: string): [number, number] | null {
  const lowerMessage = message.toLowerCase();

  // Match patterns like "2pm", "2 pm", "2:30pm", "2:30 pm", "14:00"
  const timePatterns = [
    /(\d{1,2}):(\d{2})\s*(am|pm)/i,
    /(\d{1,2})\s*(am|pm)/i,
    /(\d{1,2}):(\d{2})/,
  ];

  for (const pattern of timePatterns) {
    const match = lowerMessage.match(pattern);
    if (match) {
      let hour = Number.parseInt(match[1], 10);
      const minute =
        match[2] && !match[2].match(/am|pm/i)
          ? Number.parseInt(match[2], 10)
          : 0;
      const meridiem = (match[3] || match[2])?.toLowerCase();

      if (meridiem === 'pm' && hour < 12) hour += 12;
      if (meridiem === 'am' && hour === 12) hour = 0;

      return [hour, minute];
    }
  }

  return null;
}

/**
 * Extract day of week from user message
 */
function extractDayOfWeek(message: string): number | null {
  const lowerMessage = message.toLowerCase();

  for (const [dayName, dayNumber] of Object.entries(DAY_PATTERNS)) {
    // Match whole word boundaries
    const pattern = new RegExp(`\\b${dayName}\\b`, 'i');
    if (pattern.test(lowerMessage)) {
      return dayNumber;
    }
  }

  return null;
}

/**
 * Check for ordinal selection ("the first one", "second", etc.)
 */
function extractOrdinalSelection(
  message: string,
  totalSlots: number
): number | null {
  const lowerMessage = message.toLowerCase();

  for (const { patterns, index } of ORDINAL_PATTERNS) {
    for (const pattern of patterns) {
      if (lowerMessage.includes(pattern)) {
        // Handle "last" by returning the last index
        if (index === -1) return totalSlots - 1;
        // Ensure index is within bounds
        if (index < totalSlots) return index;
      }
    }
  }

  return null;
}

/**
 * Check for affirmative responses when only one slot was offered
 */
function isAffirmative(message: string): boolean {
  const affirmatives = [
    'yes',
    'yeah',
    'yep',
    'sure',
    'ok',
    'okay',
    'perfect',
    'great',
    'that works',
    'sounds good',
    'book it',
    "let's do it",
    "i'll take it",
    'please',
    'confirm',
  ];
  const lowerMessage = message.toLowerCase();
  return affirmatives.some((a) => lowerMessage.includes(a));
}

/**
 * Check for requests for different time/day
 */
function detectNegotiationRequest(message: string): string | null {
  const lowerMessage = message.toLowerCase();

  const patterns = [
    {
      pattern: /do you have (anything|something) (else|different)/i,
      type: 'different',
    },
    { pattern: /any other (time|option|slot|day)/i, type: 'different' },
    { pattern: /later (in the day|time)/i, type: 'later' },
    { pattern: /earlier (in the day|time)/i, type: 'earlier' },
    { pattern: /next week/i, type: 'next_week' },
    { pattern: /different day/i, type: 'different_day' },
    { pattern: /morning/i, type: 'morning' },
    { pattern: /afternoon/i, type: 'afternoon' },
    { pattern: /evening/i, type: 'evening' },
  ];

  for (const { pattern, type } of patterns) {
    if (pattern.test(lowerMessage)) {
      return type;
    }
  }

  return null;
}

/**
 * Parse the lead's reply to match one of the offered slots.
 *
 * Handles:
 * - Ordinal references: "the first one", "second option", "last one"
 * - Day + time: "Thursday at 2pm", "Friday 10am"
 * - Time only: "2pm", "10:30"
 * - Day only: "Thursday", "Friday works"
 * - Affirmatives when single slot: "yes", "perfect", "book it"
 * - Negotiation requests: "do you have anything later?", "next week?"
 */
const parseSlotSelectionImpl = async (
  input: ParseSlotSelectionInput
): Promise<Result<ParseSlotSelectionResult>> => {
  const parsed = parseSlotSelectionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userMessage, offeredSlots } = parsed.data;

  if (offeredSlots.length === 0) {
    return ok({
      matched: false,
      confidence: 'none',
    });
  }

  // Check for negotiation request first
  const negotiationRequest = detectNegotiationRequest(userMessage);
  if (negotiationRequest) {
    return ok({
      matched: false,
      confidence: 'medium',
      needsNegotiation: true,
      requestedAlternative: negotiationRequest,
    });
  }

  // Check for ordinal selection
  const ordinalIndex = extractOrdinalSelection(
    userMessage,
    offeredSlots.length
  );
  if (
    ordinalIndex !== null &&
    ordinalIndex >= 0 &&
    ordinalIndex < offeredSlots.length
  ) {
    return ok({
      matched: true,
      selectedSlot: offeredSlots[ordinalIndex],
      confidence: 'high',
    });
  }

  // If only one slot was offered and user is affirmative
  if (offeredSlots.length === 1 && isAffirmative(userMessage)) {
    return ok({
      matched: true,
      selectedSlot: offeredSlots[0],
      confidence: 'high',
    });
  }

  // Try to match by day and/or time
  const requestedDay = extractDayOfWeek(userMessage);
  const requestedTime = parseTimeFromMessage(userMessage);

  // Filter slots that match the day (if specified)
  let candidates = offeredSlots;
  if (requestedDay !== null) {
    candidates = offeredSlots.filter((slot) => {
      const slotDate = new Date(slot.isoStart);
      return slotDate.getDay() === requestedDay;
    });
  }

  if (candidates.length === 0 && requestedDay !== null) {
    // User asked for a day we didn't offer
    return ok({
      matched: false,
      confidence: 'low',
      needsNegotiation: true,
      requestedAlternative: `day_${requestedDay}`,
    });
  }

  // If we have a time, try to match it.
  //
  // This must prefer the EXACT slot. The previous implementation took the
  // first slot within +/-30 minutes of the requested time, which — with the
  // 30-minute slot interval we offer — meant an adjacent slot always
  // qualified and `.find()` returned it first. Asking for "9:30" booked the
  // 9:00 slot: |0 - 30| = 30 <= 30. Booking someone into a time they did not
  // choose is worse than failing to match, so exact wins outright, and any
  // fallback picks the CLOSEST candidate rather than the first one found.
  if (requestedTime !== null) {
    const [hour, minute] = requestedTime;
    const requestedTotal = hour * 60 + minute;

    const withDistance = candidates
      .map((slot) => {
        const [slotHour, slotMinute] = slot.startTime
          .split(':')
          .map((v) => Number.parseInt(v, 10));
        return {
          slot,
          distance: Math.abs(slotHour * 60 + slotMinute - requestedTotal),
        };
      })
      .sort((a, b) => a.distance - b.distance);

    const exact = withDistance.find((c) => c.distance === 0);
    if (exact) {
      return ok({
        matched: true,
        selectedSlot: exact.slot,
        confidence: 'high',
      });
    }

    // No exact slot. Only accept a near miss when it is unambiguous — i.e.
    // strictly closer than every other candidate — otherwise ask rather than
    // guess between two equally plausible times.
    const [closest, runnerUp] = withDistance;
    const NEAR_MISS_TOLERANCE_MINUTES = 15;
    if (
      closest &&
      closest.distance <= NEAR_MISS_TOLERANCE_MINUTES &&
      (!runnerUp || runnerUp.distance > closest.distance)
    ) {
      return ok({
        matched: true,
        selectedSlot: closest.slot,
        confidence: 'medium',
      });
    }

    // A time was named but no slot is close enough to book safely. Fall
    // through so the lead is asked to clarify instead of being booked into
    // whatever happened to be nearest.
  }

  // If only day was matched and there's exactly one slot on that day
  if (requestedDay !== null && candidates.length === 1) {
    return ok({
      matched: true,
      selectedSlot: candidates[0],
      confidence: 'medium',
    });
  }

  // If day was matched but multiple slots on that day
  if (requestedDay !== null && candidates.length > 1) {
    return ok({
      matched: false,
      confidence: 'low',
      needsNegotiation: true,
      requestedAlternative: 'clarify_time',
    });
  }

  // Could not match
  return ok({
    matched: false,
    confidence: 'none',
  });
};

export const parseSlotSelection = (input: ParseSlotSelectionInput) =>
  trackedResult(
    'chatbots.parseSlotSelection',
    () => parseSlotSelectionImpl(input),
    {
      properties: { slotsCount: input.offeredSlots.length },
    }
  );
