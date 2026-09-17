import { appointment, withPublicOrgScope } from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import { getGeneralBookingSlots } from '../../../booking-forms/services/get-general-booking-slots/get-general-booking-slots.service.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { evaluateBookingPolicy } from '../../shared/cancellation-policy.js';
import { resolveManageToken } from '../../shared/resolve-manage-token.js';
import { sendRescheduleEmail } from '../send-reschedule-email/send-reschedule-email.service.js';
import {
  asResourceFeatureError,
  reallocateAppointmentResources,
} from '../shared/allocate-appointment-resources.js';
import {
  type RescheduleManagedAppointmentInput,
  rescheduleManagedAppointmentSchema,
} from './reschedule-managed-appointment.schema.js';

/**
 * The patient moves their own booking.
 *
 * Two independent gates, and both are load-bearing:
 *
 *  1. The requested start must be a slot the booking page is ACTUALLY offering
 *     (we re-derive them from `getGeneralBookingSlots` rather than trusting the
 *     client). This is what enforces opening hours, shifts, time off and
 *     blocked time — reusing the one code path that knows about all of them
 *     instead of reimplementing a weaker copy here.
 *  2. The DB's `appointment_no_overlap` exclusion constraint. Gate 1 races —
 *     two patients can be offered the same slot and both accept — so the
 *     constraint is what actually decides, and we translate its violation into
 *     a CONFLICT the UI can re-offer from.
 *
 * The appointment keeps its duration; only the start moves.
 */
const rescheduleManagedAppointmentImpl = async (
  db: DbConnection,
  input: RescheduleManagedAppointmentInput
): Promise<
  Result<{ appointmentId: string; startDate: Date; endDate: Date }>
> => {
  const parsed = rescheduleManagedAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationSlug, startDate } = parsed.data;

  const resolved = await resolveManageToken(db, parsed.data);
  if (!resolved.success) return resolved;

  const { org, appointment: appt } = resolved.data;

  // The clinic's online-rescheduling TOGGLE, which this path never consulted —
  // the portal enforced it, the manage link in every confirmation email did
  // not. Same shared evaluator on both sides now. The notice window does not
  // block (see evaluateBookingPolicy); only the toggle does.
  const decision = evaluateBookingPolicy(org, 'reschedule', appt.startDate);
  if (!decision.allowed) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        decision.deniedReason ?? 'Online rescheduling is unavailable.'
      )
    );
  }

  if (!(activeAppointmentStatuses as readonly string[]).includes(appt.status)) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This booking can no longer be rescheduled'
      )
    );
  }

  if (startDate.getTime() <= Date.now()) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Please choose a time in the future'
      )
    );
  }

  if (!appt.serviceId) {
    // Without a service we cannot derive the offered slots, and silently
    // skipping gate 1 would let a patient move an appointment to 3am.
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'This booking cannot be rescheduled online — please contact the clinic'
      )
    );
  }

  // Preserve the booked duration rather than re-deriving it from the service:
  // the clinic may have edited the service length since, and the patient agreed
  // to the appointment they have.
  const durationMs = appt.endDate.getTime() - appt.startDate.getTime();
  const endDate = new Date(startDate.getTime() + durationMs);

  // ── Gate 1: is this a slot we are actually offering? ──────────────────────
  const dayStart = new Date(startDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(startDate);
  dayEnd.setHours(23, 59, 59, 999);

  // Scoped to THE BRANCH THIS APPOINTMENT IS ALREADY ON. The update below sets
  // only `startDate`/`endDate`, so `location_id` survives a reschedule
  // untouched — which means a gate drawn from any other branch validates the
  // new time against a diary the appointment will never be on. That is the
  // Cork-patient-offered-Dublin's-slots defect: the row stayed Cork, so Cork's
  // room was double-booked and Dublin showed a slot it never sold.
  //
  // By id, not by slug: `organization_location.slug` is still nullable
  // pre-backfill, and the one caller that must never guess a branch cannot be
  // the one that goes branch-less when a slug is missing.
  //
  // A NULL `location_id` (every pre-backfill appointment) passes `undefined`
  // and keeps today's default-branch behaviour. That is not a silent fallback:
  // such a row is on NO branch, so there is no branch to disagree with and
  // nothing a reschedule can move it away from.
  const slots = await getGeneralBookingSlots(db, {
    organizationSlug,
    serviceId: appt.serviceId,
    startDate: dayStart,
    endDate: dayEnd,
    practitionerId: appt.practitionerId ?? undefined,
    locationId: appt.locationId ?? undefined,
  });

  if (!slots.success) {
    // A genuine fault (DB down) must not be dressed up as "pick another time" —
    // that would tell the patient to keep retrying a broken system.
    if (slots.error.code === ErrorCodes.INTERNAL_ERROR) {
      logError(
        'appointments.rescheduleManagedAppointment.slots',
        new Error(slots.error.message),
        {
          feature: 'appointments',
          extra: { appointmentId: appt.id, organizationId: org.id },
        }
      );
      return err(
        new FeatureError(
          ErrorCodes.INTERNAL_ERROR,
          'Could not check availability — please try again'
        )
      );
    }

    // Everything else means "we cannot offer this patient a slot" — most often
    // because the practitioner pinned to their booking no longer performs this
    // service, so the slots service has nothing to draw from. That is an
    // ordinary state of the world, not a server fault: 500ing at the patient
    // helps nobody. Tell them, and point them at a human.
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'That time is not available — please pick another, or contact the clinic'
      )
    );
  }

  const isOffered = slots.data.slots.some(
    (slot) => slot.startTime.getTime() === startDate.getTime()
  );

  if (!isOffered) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'That time is no longer available — please pick another'
      )
    );
  }

  // ── Gate 2: the exclusion constraint decides. ─────────────────────────────
  try {
    const updated = await withPublicOrgScope(
      org.id,
      (tx) =>
        tx
          .update(appointment)
          // `locationId` is deliberately absent from this set: a reschedule
          // moves a booking in TIME, never between branches. Gate 1 above is
          // what makes that a promise rather than an accident — it draws the
          // offered slots from this same, unchanged branch.
          .set({ startDate, endDate })
          .where(
            and(
              eq(appointment.id, appt.id),
              eq(appointment.organizationId, org.id),
              inArray(appointment.status, [...activeAppointmentStatuses])
            )
          )
          .returning({ id: appointment.id }),
      { db }
    );

    if (updated.length === 0) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This booking can no longer be rescheduled'
        )
      );
    }
  } catch (error) {
    // The exclusion constraint fired: someone took the slot between gate 1 and
    // here. That is a normal race, not a bug — hand the UI a CONFLICT so it can
    // refresh the slot list.
    const msg = error instanceof Error ? error.message : '';
    if (
      msg.includes('appointment_no_overlap') ||
      msg.includes('conflicting key value')
    ) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'That time was just taken — please pick another'
        )
      );
    }

    logError('appointments.rescheduleManagedAppointment', error, {
      feature: 'appointments',
      extra: { appointmentId: appt.id, organizationId: org.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to reschedule')
    );
  }

  // Best-effort — the move is committed; a failed email must not report failure
  // and tempt the patient into rescheduling again.
  // Move the room hold with the booking: release the old range, take the new
  // one. Gate 1 above already refused times with no free room (the slot list it
  // re-derives is resource-gated), so reaching here with nothing free means we
  // lost the same race `appointment_no_overlap` guards — rare, and by then the
  // move is committed, so it is recorded rather than refused.
  try {
    await withPublicOrgScope(
      org.id,
      (tx) =>
        reallocateAppointmentResources(tx, {
          appointmentId: appt.id,
          organizationId: org.id,
        }),
      { db }
    );
  } catch (error) {
    const featureError = asResourceFeatureError(error);
    if (!featureError) throw error;
    logError(
      'appointments.rescheduleManagedAppointment.reallocateResources',
      new Error(featureError.message),
      {
        feature: 'appointments',
        extra: { appointmentId: appt.id, organizationId: org.id },
      }
    );
  }

  try {
    await sendRescheduleEmail(db, {
      appointmentId: appt.id,
      organizationId: org.id,
      oldStartDate: appt.startDate,
      oldEndDate: appt.endDate,
    });
  } catch (error) {
    logError('appointments.rescheduleManagedAppointment.email', error, {
      feature: 'appointments',
      extra: { appointmentId: appt.id, organizationId: org.id },
    });
  }

  return ok({ appointmentId: appt.id, startDate, endDate });
};

export const rescheduleManagedAppointment = (
  db: DbConnection,
  input: RescheduleManagedAppointmentInput
) =>
  trackedResult(
    'appointments.rescheduleManagedAppointment',
    () => rescheduleManagedAppointmentImpl(db, input),
    { properties: { organizationSlug: input.organizationSlug } }
  );

export type RescheduleManagedAppointmentResult = Awaited<
  ReturnType<typeof rescheduleManagedAppointment>
>;
