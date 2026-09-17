import { randomInt } from 'node:crypto';
import {
  type WorkingHours,
  appointment,
  conversation,
  lead,
  member,
  organization,
  organizationLocation,
  practitioner as practitionerTable,
} from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import {
  logError,
  trackOrgEvent,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, gt, inArray, lt } from 'drizzle-orm';
import { createAppointment } from '../../../appointments/services/create-appointment/index.js';
import { releaseLeadHolds } from '../../../appointments/services/release-lead-holds/index.js';
import { restoreLeadHolds } from '../../../appointments/services/restore-lead-holds/index.js';
import { resolveAvailability } from '../../../scheduling/services/resolve-availability/index.js';
import {
  hasFreeResourcesFor,
  loadResourceGateContext,
} from '../../../scheduling/services/resolve-resource-availability/index.js';
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
  type BookDirectAppointmentInput,
  type BookDirectAppointmentResult,
  bookDirectAppointmentSchema,
} from './direct-booking.schema.js';

/**
 * Generate a confirmation code for the booking
 */
function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'APT-';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  return code;
}

/**
 * Format time for display (e.g., "2:30 PM") in the CLINIC's timezone.
 *
 * `timeZone` is required. These formatters previously defaulted to the
 * server's local zone, so a booking stored at 09:30 UTC for a UTC clinic was
 * confirmed to the customer as "11:30 AM" on a UTC+2 host — the customer held
 * a written confirmation two hours after their real appointment.
 */
function formatTimeForDisplay(date: Date, timeZone: string): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone,
  });
}

/**
 * Format date for display (e.g., "Thursday, January 15") in the clinic's
 * timezone — the date itself can differ from the server's near midnight.
 */
function formatDateForDisplay(date: Date, timeZone: string): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone,
  });
}

/**
 * Find or create a lead for the conversation
 */
async function findOrCreateLead(
  db: DbConnection,
  organizationId: string,
  conversationId: string,
  customerName: string,
  customerPhone?: string,
  customerEmail?: string
): Promise<{ id: string }> {
  // Load conversation to get external user ID and platform
  const conv = await db.query.conversation.findFirst({
    where: eq(conversation.id, conversationId),
    columns: {
      externalUserId: true,
      platform: true,
    },
  });

  if (!conv) {
    throw new FeatureError(ErrorCodes.NOT_FOUND, 'Conversation not found');
  }

  // Build match conditions based on platform
  const matchConditions =
    conv.platform === 'whatsapp'
      ? eq(lead.whatsapp, conv.externalUserId)
      : eq(lead.facebookLeadId, conv.externalUserId);

  // Check if lead already exists for this external user
  const existingLead = await db.query.lead.findFirst({
    where: and(
      eq(lead.organizationId, organizationId),
      matchConditions,
      notDeleted(lead)
    ),
    columns: { id: true },
  });

  if (existingLead) {
    return { id: existingLead.id };
  }

  // Map platform to lead source
  const sourceMap = {
    facebook_messenger: 'facebook' as const,
    instagram_dm: 'instagram' as const,
    whatsapp: 'whatsapp' as const,
    sms: 'sms' as const,
  };

  // Create a new lead
  const [newLead] = await db
    .insert(lead)
    .values({
      organizationId,
      firstName: customerName.split(/\s+/)[0],
      lastName: customerName.split(/\s+/).slice(1).join(' ') || undefined,
      phone: customerPhone,
      email: customerEmail,
      source: sourceMap[conv.platform],
      status: 'contacted',
      // They booked through a conversation they started — contactable.
      consentEmail: true,
      consentSms: true,
      consentVoice: true,
      consentSource: 'incoming_message',
      consentedAt: new Date(),
      // `externalUserId` means a different identity per platform: a WhatsApp
      // phone, an E.164 number on SMS, or a Meta PSID/IGSID. `phone` is already
      // set from `customerPhone` above, so SMS needs no extra identity column —
      // writing the number into `facebookLeadId` would corrupt Meta matching.
      ...(conv.platform === 'whatsapp'
        ? { whatsapp: conv.externalUserId }
        : conv.platform === 'sms'
          ? {}
          : { facebookLeadId: conv.externalUserId }),
    })
    .returning();

  return { id: newLead.id };
}

/**
 * Get the default assigned user for appointments in this organization.
 * Returns the first member of the org.
 */
async function getDefaultAssignedUser(
  db: DbConnection,
  organizationId: string
): Promise<string | null> {
  // Get any user who is a member of this organization
  const orgMember = await db.query.member.findFirst({
    where: eq(member.organizationId, organizationId),
    columns: { userId: true },
  });

  return orgMember?.userId ?? null;
}

/**
 * Check if the slot is still available (handle race conditions)
 */
async function isSlotAvailable(
  db: DbConnection,
  organizationId: string,
  startDate: Date,
  endDate: Date,
  practitionerId?: string
): Promise<boolean> {
  const conflicting = await db.query.appointment.findFirst({
    where: and(
      eq(appointment.organizationId, organizationId),
      inArray(appointment.status, [...activeAppointmentStatuses]),
      notDeleted(appointment),
      practitionerId
        ? eq(appointment.practitionerId, practitionerId)
        : undefined,
      lt(appointment.startDate, endDate),
      gt(appointment.endDate, startDate)
    ),
    columns: { id: true },
  });

  if (conflicting) return false;

  // Defense-in-depth: when we know the practitioner, re-check the slot against
  // real availability (on-shift + not blocked/time-off) so a slot that became
  // unavailable between offer and confirm can't be booked. Only tightens the
  // check; fails OPEN on any error (the offer already validated availability).
  if (practitionerId) {
    const bookable = await slotWithinAvailability(
      db,
      organizationId,
      practitionerId,
      startDate,
      endDate
    );
    if (bookable === false) return false;
  }

  return true;
}

/**
 * Re-validate a slot against resolved availability for a specific practitioner.
 * Returns true if bookable, false if off-shift / blocked / on time off, and
 * null if it could not be determined (caller should not block on null).
 */
async function slotWithinAvailability(
  db: DbConnection,
  organizationId: string,
  practitionerId: string,
  startDate: Date,
  endDate: Date
): Promise<boolean | null> {
  try {
    const org = await db.query.organization.findFirst({
      where: eq(organization.id, organizationId),
      columns: { businessHours: true, timezone: true },
    });
    const prac = await db.query.practitioner.findFirst({
      where: eq(practitionerTable.id, practitionerId),
      columns: { workingHours: true },
      with: { locations: { columns: { workingHours: true } } },
    });

    const [avail] = await resolveAvailability(db, {
      organizationId,
      practitionerIds: [practitionerId],
      from: startDate,
      to: endDate,
      timeZone: org?.timezone || 'UTC',
      orgBusinessHours: (org?.businessHours as WorkingHours | null) ?? null,
      fallbackHours: [
        {
          practitionerId,
          workingHours: prac?.workingHours ?? null,
          locationWorkingHours: prac?.locations?.[0]?.workingHours ?? null,
        },
      ],
    });
    if (!avail) return null;

    const onShift = avail.working.some(
      (w) => startDate >= w.start && endDate <= w.end
    );
    const blocked = avail.busy.some(
      (b) => startDate < b.end && endDate > b.start
    );
    return onShift && !blocked;
  } catch (error) {
    logError('chatbots.bookDirectAppointment.availabilityRecheck', error, {
      feature: 'chatbots',
      extra: { organizationId, practitionerId },
    });
    return null;
  }
}

/**
 * Re-validate the slot against RESOURCE availability (treatment room, laser,
 * chair) at confirm time.
 *
 * The offer was already gated — `offerBookingSlots` → `checkAvailability` runs
 * the same gate before Claire ever quotes a time — but minutes of conversation
 * can pass between "how about 2pm?" and "yes please", and the clinic's only
 * laser can be taken by the front desk in that window. A free practitioner is
 * not enough to confirm on.
 *
 * Returns true when bookable, false when some required category has NOTHING
 * free, and null when it could not be determined. Errors fail OPEN (null) to
 * match `slotWithinAvailability` above: a transient read failure must not turn
 * a legitimate confirmation into "that slot was just taken". A definitive
 * "no free resource", though, blocks — that is the whole point of the gate.
 *
 * ZERO-COST ROLLOUT PATH: `loadResourceGateContext` returns null when no
 * service in the cart carries a requirement row, which is every org that has
 * not configured a resource. Null returns null here, so the booking proceeds on
 * exactly the pre-resources path. Without a `serviceId` there is no cart to
 * carry requirements, so the lookup is not even attempted.
 */
async function slotHasFreeResources(
  db: DbConnection,
  organizationId: string,
  serviceId: string | undefined,
  startDate: Date,
  endDate: Date,
  timeZone: string
): Promise<boolean | null> {
  if (!serviceId) return null;

  try {
    // The location whose rooms are in play. Same primary-location convention
    // `checkAvailability` used when the slot was OFFERED, so confirm-time and
    // offer-time consider the same candidate resources — a laxer check here
    // would confirm slots the offer would never have quoted.
    const primaryLocation = await db.query.organizationLocation.findFirst({
      where: and(
        eq(organizationLocation.organizationId, organizationId),
        eq(organizationLocation.isPrimary, true)
      ),
      columns: { id: true },
    });

    const ctx = await loadResourceGateContext(db, {
      organizationId,
      // Single-service today; the array is what a multi-service cart fills in.
      serviceIds: [serviceId],
      from: startDate,
      to: endDate,
      // The clinic's zone, resolved by the caller — resource working hours are
      // wall-clock and must never be read as UTC.
      timeZone,
      locationId: primaryLocation?.id ?? null,
    });
    if (!ctx) return null;

    return hasFreeResourcesFor(ctx, startDate, endDate);
  } catch (error) {
    logError('chatbots.bookDirectAppointment.resourceRecheck', error, {
      feature: 'chatbots',
      extra: { organizationId, serviceId },
    });
    return null;
  }
}

/**
 * Book an appointment directly on the lead's behalf.
 *
 * This is the final step in the direct booking flow:
 * 1. Validates the slot is still available
 * 2. Creates or finds the lead
 * 3. Creates the appointment
 * 4. Returns confirmation details
 */
const bookDirectAppointmentImpl = async (
  db: DbConnection,
  input: BookDirectAppointmentInput
): Promise<Result<BookDirectAppointmentResult>> => {
  const parsed = bookDirectAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    organizationId,
    slotIsoStart,
    slotIsoEnd,
    serviceId,
    practitionerId,
    customerName,
    customerPhone,
    customerEmail,
  } = parsed.data;

  const startDate = new Date(slotIsoStart);
  const endDate = new Date(slotIsoEnd);

  // Every customer-facing time in this flow is rendered in the CLINIC's zone,
  // never the server's. Loaded once here and threaded into the confirmation.
  const bookingOrg = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
    columns: { timezone: true, holdExpirationHours: true },
  });
  const orgTimeZone = bookingOrg?.timezone || 'UTC';
  const holdExpiresAt = new Date(
    Date.now() + (bookingOrg?.holdExpirationHours ?? 24) * 60 * 60 * 1000
  );

  // Check if slot is still available
  const available = await isSlotAvailable(
    db,
    organizationId,
    startDate,
    endDate,
    practitionerId
  );

  // A free practitioner is only half the answer. Gate the CONFIRM on a free
  // eligible resource too (see slotHasFreeResources): the room or device can go
  // between the slot being offered and the customer saying yes. Only a
  // definitive `false` blocks — `null` (no requirements, or an unreadable
  // check) leaves the pre-resources behaviour untouched. Evaluated after the
  // practitioner check so an already-taken slot costs no extra reads.
  const resourcesFree = available
    ? await slotHasFreeResources(
        db,
        organizationId,
        serviceId,
        startDate,
        endDate,
        orgTimeZone
      )
    : null;

  if (!available || resourcesFree === false) {
    return ok({
      success: false,
      appointmentId: '',
      confirmationCode: '',
      confirmationMessage:
        "I'm sorry, that slot was just taken! Let me find you some other options.",
      slotTaken: true,
    });
  }

  // Find or create lead
  let leadRecord: { id: string };
  try {
    leadRecord = await findOrCreateLead(
      db,
      organizationId,
      conversationId,
      customerName,
      customerPhone,
      customerEmail
    );
  } catch (error) {
    logError('chatbots.bookDirectAppointment.findOrCreateLead', error, {
      feature: 'chatbots',
      extra: { conversationId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create booking')
    );
  }

  // Generate confirmation code
  const confirmationCode = generateConfirmationCode();

  // Get the assigned user for the appointment
  const assignedToId = await getDefaultAssignedUser(db, organizationId);
  if (!assignedToId) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'No user available to assign appointment'
      )
    );
  }

  // One live hold per lead: a customer who says "actually, can I do Thursday
  // instead?" should not end up sitting on two slots. Released BEFORE the new
  // hold is created, so the old slot is free even if the customer re-picks it —
  // `held` is an active status and `appointment_no_overlap` is enforced by the
  // database, so releasing afterwards would make re-picking the same slot
  // collide with the customer's own hold.
  //
  // What it released is kept so it can be UNDONE. `createAppointment` can still
  // fail after this point — most often CONFLICT, the slot going between the
  // availability check and the insert — and without a compensating restore the
  // customer walks away holding nothing: their original reservation cancelled,
  // the new one refused. The two cannot simply share a transaction:
  // `createAppointment` enqueues calendar sync and notifies the practitioner,
  // and holding a pooled connection across that I/O is what wedged the pool in
  // production.
  const releaseResult = await releaseLeadHolds(db, {
    organizationId,
    leadId: leadRecord.id,
  });
  const priorHolds = releaseResult.success ? releaseResult.data.released : [];

  // Created as a HOLD, not a booking: nothing has been paid and the customer
  // may simply stop replying. Before `holdExpiresAt` existed these rows stayed
  // `booked` forever and blocked the slot indefinitely.
  const appointmentResult = await createAppointment(db, {
    organizationId,
    leadId: leadRecord.id,
    assignedToId,
    title: `Appointment - ${customerName}`,
    startDate,
    endDate,
    status: 'held',
    holdExpiresAt,
    source: 'booking_form',
    practitionerId,
    // The service Claire booked, which this flow previously dropped on the
    // floor. `createAppointment` owns resource ALLOCATION (writing the
    // appointment_resource holds) and needs the cart to know what to allocate —
    // without this the gate above would keep re-passing, because nothing ever
    // takes the room. Deliberately not writing allocation rows from here.
    serviceId,
    color: 'blue',
  });

  if (!appointmentResult.success) {
    // The new hold did not happen, so the old one should never have been
    // given up. Put it back before answering.
    await restoreLeadHolds(db, { organizationId, holds: priorHolds });

    // Check if it's a conflict (slot taken between check and create)
    if (appointmentResult.error.code === ErrorCodes.CONFLICT) {
      return ok({
        success: false,
        appointmentId: '',
        confirmationCode: '',
        confirmationMessage:
          "I'm sorry, that slot was just taken! Let me find you some other options.",
        slotTaken: true,
      });
    }
    return err(
      new FeatureError(
        appointmentResult.error.code,
        appointmentResult.error.message,
        appointmentResult.error.details
      )
    );
  }

  // Build confirmation message
  const dateStr = formatDateForDisplay(startDate, orgTimeZone);
  const timeStr = formatTimeForDisplay(startDate, orgTimeZone);
  const confirmationMessage = `You're all booked for ${dateStr} at ${timeStr}. Your confirmation code is ${confirmationCode}. See you then!`;

  // Track the booking
  trackOrgEvent(organizationId, 'direct_booking_completed', {
    conversationId,
    appointmentId: appointmentResult.data.id,
    source: 'chatbot_direct_booking',
  });

  return ok({
    success: true,
    appointmentId: appointmentResult.data.id,
    confirmationCode,
    confirmationMessage,
  });
};

export const bookDirectAppointment = (
  db: DbConnection,
  input: BookDirectAppointmentInput
) =>
  trackedResult(
    'chatbots.bookDirectAppointment',
    () => bookDirectAppointmentImpl(db, input),
    {
      properties: {
        conversationId: input.conversationId,
        organizationId: input.organizationId,
      },
    }
  );
