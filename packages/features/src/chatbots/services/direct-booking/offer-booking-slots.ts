import {
  conversation,
  organization,
  organizationService,
} from '@borradh-workspace/database';
import type {
  ConversationMetadata,
  OfferedSlot,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { checkAvailability } from '../../../calendar/services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  DEFAULT_DAYS_AHEAD,
  DEFAULT_SLOTS_TO_OFFER,
  type OfferBookingSlotsInput,
  type OfferBookingSlotsResult,
  offerBookingSlotsSchema,
} from './direct-booking.schema.js';
import { spreadSlots } from './spread-slots.js';

/**
 * Format a date as "Thursday, January 15"
 */
function formatDateForVoice(dateStr: string): string {
  const date = new Date(dateStr);
  // `dateStr` is a plain calendar date ("2026-07-20"), which parses as UTC
  // midnight. Formatting without a timeZone used the server's zone, so any
  // host west of UTC rendered the PREVIOUS day — a US clinic offering
  // "Sunday, July 19" for a slot that is actually Monday the 20th. Pinning to
  // UTC round-trips the calendar date unchanged.
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Build a natural language message offering slots to the lead.
 */
function buildSlotsMessage(slots: OfferedSlot[], customerName: string): string {
  if (slots.length === 0) {
    const sorryName =
      customerName && customerName.toLowerCase() !== 'there'
        ? ` ${customerName.split(/\s+/)[0]}`
        : '';
    return `I'm sorry${sorryName}, I don't have any available appointments in the next few days. What days typically work best for you?`;
  }

  // `customerName` falls back to the literal 'there' when we don't know who
  // we're talking to, which produced messages opening "there, I can see ...".
  // Only address someone by name when we actually have one.
  const firstName = customerName.split(/\s+/)[0] || '';
  const greeting =
    firstName && firstName.toLowerCase() !== 'there' ? `${firstName}, ` : '';

  if (slots.length === 1) {
    const slot = slots[0];
    const dateStr = formatDateForVoice(slot.date);
    return `${greeting}I can see we have availability on ${dateStr} at ${slot.displayTime}. Would that work for you?`;
  }

  // Group slots by date for cleaner presentation
  const slotsByDate = new Map<string, OfferedSlot[]>();
  for (const slot of slots) {
    const existing = slotsByDate.get(slot.date) ?? [];
    existing.push(slot);
    slotsByDate.set(slot.date, existing);
  }

  if (slotsByDate.size === 1) {
    // All slots on same day
    const [dateStr, daySlots] = [...slotsByDate.entries()][0];
    const dateFormatted = formatDateForVoice(dateStr);
    const times = daySlots.map((s) => s.displayTime).join(', ');
    return `${greeting}I can see we have availability on ${dateFormatted} at ${times}. Which works best for you?`;
  }

  // Multiple days - show one slot per day for clarity
  const options = [...slotsByDate.entries()]
    .slice(0, 3)
    .map(([dateStr, daySlots]) => {
      const dateFormatted = formatDateForVoice(dateStr);
      return `${dateFormatted} at ${daySlots[0].displayTime}`;
    })
    .join(', ');

  return `${greeting}I can see we have ${options}. Which works best for you?`;
}

/**
 * Fetch available slots and format a natural language message for the lead.
 *
 * This service:
 * 1. Looks up the service the lead asked about (if known)
 * 2. Queries calendar for next N available slots
 * 3. Formats slots into a natural-language message for Claire to send
 */
const offerBookingSlotsImpl = async (
  db: DbConnection,
  input: OfferBookingSlotsInput
): Promise<Result<OfferBookingSlotsResult>> => {
  const parsed = offerBookingSlotsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { conversationId, organizationId, serviceId, slotsToOffer, daysAhead } =
    parsed.data;

  // Load conversation for metadata (customer name, discussed treatments)
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    columns: {
      metadata: true,
      externalUserName: true,
    },
  });

  if (!conv) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found')
    );
  }

  const metadata = (conv.metadata as ConversationMetadata | null) ?? {};
  const customerName = metadata.name ?? conv.externalUserName ?? 'there';

  // Resolve service ID from metadata if not provided
  let resolvedServiceId = serviceId;
  if (!resolvedServiceId && metadata.treatmentsDiscussed?.length) {
    // Try to find a service matching the discussed treatment
    const service = await db.query.organizationService.findFirst({
      where: eq(organizationService.organizationId, organizationId),
      columns: { id: true, name: true },
    });
    if (service) {
      resolvedServiceId = service.id;
    }
  }

  // Load org to get default appointment duration
  const org = await db.query.organization.findFirst({
    where: and(eq(organization.id, organizationId), notDeleted(organization)),
    columns: {
      defaultAppointmentDuration: true,
      timezone: true,
    },
  });

  const duration = org?.defaultAppointmentDuration ?? 30;
  // Was hardcoded to 'Europe/Dublin', which offered non-IE orgs slots shifted
  // by their UTC offset — the times quoted in chat then disagreed with the
  // calendar the appointment actually lands in.
  const timeZone = org?.timezone ?? 'UTC';

  // Collect slots across multiple days
  const allSlots: OfferedSlot[] = [];
  const today = new Date();
  const effectiveSlotsToOffer = slotsToOffer ?? DEFAULT_SLOTS_TO_OFFER;
  const effectiveDaysAhead = daysAhead ?? DEFAULT_DAYS_AHEAD;

  for (
    let dayOffset = 1;
    dayOffset <= effectiveDaysAhead && allSlots.length < effectiveSlotsToOffer;
    dayOffset++
  ) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() + dayOffset);
    const dateStr = checkDate.toISOString().split('T')[0];

    // Slots come back already gated on RESOURCES (treatment room / laser /
    // chair) as well as practitioners: checkAvailability loads the resource
    // context once per day it is asked about and drops slots no free eligible
    // resource can serve. That is why `resolvedServiceId` matters beyond
    // duration — without a service there is no cart, so no requirement to
    // check, and Claire could quote a time the clinic's only laser is busy.
    // Orgs with no resources configured are unaffected (the gate no-ops).
    const availResult = await checkAvailability(db, {
      organizationId,
      date: dateStr,
      serviceId: resolvedServiceId,
      duration,
      timezone: timeZone,
      timePreference: 'any',
    });

    if (availResult.success && availResult.data.slots.length > 0) {
      const slotsNeeded = effectiveSlotsToOffer - allSlots.length;
      // Spread across the day rather than taking its first N. With three
      // slots to offer and a full day free, the head-of-day slice handed the
      // lead the same three opening-hour times every run and never showed
      // that the clinic is open all afternoon (ENG-814).
      const slotsToAdd = spreadSlots(availResult.data.slots, slotsNeeded);
      allSlots.push(...slotsToAdd);
    }
  }

  // Build the message
  const message = buildSlotsMessage(allSlots, customerName);

  return ok({
    message,
    slots: allSlots,
    noAvailability: allSlots.length === 0,
  });
};

export const offerBookingSlots = (
  db: DbConnection,
  input: OfferBookingSlotsInput
) =>
  trackedResult(
    'chatbots.offerBookingSlots',
    () => offerBookingSlotsImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
    }
  );
