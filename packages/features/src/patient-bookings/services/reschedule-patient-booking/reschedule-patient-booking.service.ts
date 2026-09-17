import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  evaluateBookingPolicy,
  issueManageToken,
  notifyOwnerReschedule,
  rescheduleManagedAppointment,
  revokeManageToken,
} from '../../../appointments/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
} from '../../../shared/index.js';
import { authorizePatientAppointment } from '../shared/authorize-patient-appointment.js';
import {
  type ReschedulePatientBookingInput,
  reschedulePatientBookingSchema,
} from './reschedule-patient-booking.schema.js';

/**
 * The signed-in patient moves their own booking.
 *
 * Same shape as cancel-patient-booking: ownership proven under
 * `withPatientScope` first, then the move is delegated to the appointments
 * feature's `rescheduleManagedAppointment` (the single writer for
 * `appointment`) via a freshly minted manage token. That service enforces both
 * gates — the slot must be one the booking page actually offers, and the DB's
 * no-overlap exclusion constraint decides races — so none of that logic is
 * duplicated here.
 */
// Return type inferred: the delegated `rescheduleManagedAppointment` result is
// the tracked `ResultShape`, whose error is structurally (not nominally) a
// FeatureError — annotating `Result<T>` here would reject it.
const reschedulePatientBookingImpl = async (
  db: DbConnection,
  input: ReschedulePatientBookingInput
) => {
  const authorized = await authorizePatientAppointment(db, input);
  if (!authorized.success) return authorized;

  const { appointment: appt, organizationSlug, organization } = authorized.data;

  // ── Rescheduling policy gate (BEFORE any mutation) ──────────────────────
  // The same shared evaluator the cancel path and the token-based manage
  // endpoints use. Only the TOGGLE blocks; a late reschedule is permitted and
  // carries the clinic's stated fee, for the same reason a late cancel is —
  // see evaluateBookingPolicy.
  const policy = evaluateBookingPolicy(
    organization,
    'reschedule',
    appt.startDate
  );
  if (!policy.allowed) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        policy.deniedReason ?? 'Online rescheduling is unavailable.'
      )
    );
  }

  // `replaceExisting: false` is load-bearing. This token is an internal
  // credential we mint, spend and immediately revoke — the patient never sees
  // it. With the default (replace) it would DELETE the token behind the
  // "Manage booking" link already sitting in their confirmation and in every
  // reminder we've sent, so a portal reschedule would silently kill those links
  // while the booking itself lived on.
  const token = await issueManageToken(db, {
    organizationId: input.organizationId,
    appointmentId: appt.id,
    appointmentEnd: appt.endDate,
    replaceExisting: false,
  });
  if (!token.success) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to reschedule booking'
      )
    );
  }

  // Captured BEFORE the move — the appointment row holds the new time once the
  // reschedule commits, so the clinic email needs the old start from here.
  const oldStartDate = appt.startDate;

  try {
    const result = await rescheduleManagedAppointment(db, {
      organizationSlug,
      token: token.data.token,
      startDate: input.startTime,
    });

    // Notify the clinic (owner) of the move. Fire-and-forget on a committed
    // reschedule only — a failed clinic email must never fail the patient's
    // reschedule.
    if (result.success) {
      notifyOwnerReschedule(db, {
        appointmentId: appt.id,
        organizationId: input.organizationId,
        oldStartDate,
      }).catch((error) =>
        logError(
          'patientBookings.reschedulePatientBooking.notifyClinic',
          error,
          {
            feature: 'patient-bookings',
            extra: {
              appointmentId: appt.id,
              organizationId: input.organizationId,
            },
          }
        )
      );
    }

    return result;
  } finally {
    // Retire our ephemeral credential whatever the outcome, so it can't
    // accumulate as an unreachable-but-valid capability row.
    await revokeManageToken(db, {
      appointmentId: appt.id,
      token: token.data.token,
    });
  }
};

export const reschedulePatientBooking = (
  db: DbConnection,
  input: ReschedulePatientBookingInput
) =>
  trackedResult(
    'patientBookings.reschedulePatientBooking',
    async () => {
      const parsed = reschedulePatientBookingSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return reschedulePatientBookingImpl(db, parsed.data);
    },
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
      },
      internalErrorsOnly: true,
    }
  );

export type ReschedulePatientBookingResult = Awaited<
  ReturnType<typeof reschedulePatientBooking>
>;
