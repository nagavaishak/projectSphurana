import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  cancelManagedAppointment,
  evaluateBookingPolicy,
  issueManageToken,
  notifyOwnerCancellation,
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
  type CancelPatientBookingInput,
  cancelPatientBookingSchema,
} from './cancel-patient-booking.schema.js';

/**
 * The signed-in patient cancels their own booking.
 *
 * Ownership is proven FIRST under `withPatientScope` (the RLS `patient_self`
 * policy — a booking the patient does not own is a NOT_FOUND). The cancel
 * itself is then delegated to the appointments feature's own
 * `cancelManagedAppointment` — the single writer for the `appointment` table —
 * by minting the same manage-token capability the confirmation email carries.
 * We never write `appointment` here.
 *
 * The minted token is ephemeral — `replaceExisting: false` on the way in and
 * revoked on the way out — so the link in the patient's already-delivered
 * emails survives. Without that, a cancel that FAILED would still have killed
 * their "Manage booking" link on a booking that is very much still live.
 */
// Return type inferred: the delegated `cancelManagedAppointment` result is the
// tracked `ResultShape`, whose error is structurally (not nominally) a
// FeatureError — annotating `Result<T>` here would reject it.
const cancelPatientBookingImpl = async (
  db: DbConnection,
  input: CancelPatientBookingInput
) => {
  const authorized = await authorizePatientAppointment(db, input);
  if (!authorized.success) return authorized;

  const { appointment: appt, organizationSlug, organization } = authorized.data;

  // ── Cancellation policy gate (BEFORE any mutation) ──────────────────────
  // One shared evaluator, used here AND by the token-based manage endpoints
  // reached from a confirmation email — which previously consulted nothing, so
  // the clinic's settings were advisory for anyone holding that email.
  //
  // Only the TOGGLE blocks. A late cancellation is permitted and carries the
  // clinic's stated fee: refusing it converts a slot the clinic could still
  // refill into a silent no-show, costing them the slot AND the notice.
  const policy = evaluateBookingPolicy(organization, 'cancel', appt.startDate);
  if (!policy.allowed) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        policy.deniedReason ?? 'Online cancellation is unavailable.'
      )
    );
  }

  // Ephemeral internal credential — minted, spent, revoked. See the same
  // pattern (and the reasoning behind `replaceExisting: false`) in
  // reschedule-patient-booking.
  const token = await issueManageToken(db, {
    organizationId: input.organizationId,
    appointmentId: appt.id,
    appointmentEnd: appt.endDate,
    replaceExisting: false,
  });
  if (!token.success) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel booking')
    );
  }

  try {
    const result = await cancelManagedAppointment(db, {
      organizationSlug,
      token: token.data.token,
      reason: input.reason,
    });

    // Notify the clinic (owner) that the customer cancelled. Fire-and-forget on
    // a committed cancel only — a failed clinic email must never fail the
    // patient's cancellation.
    if (result.success) {
      notifyOwnerCancellation(db, {
        appointmentId: appt.id,
        organizationId: input.organizationId,
        cancellationReason: input.reason,
      }).catch((error) =>
        logError('patientBookings.cancelPatientBooking.notifyClinic', error, {
          feature: 'patient-bookings',
          extra: {
            appointmentId: appt.id,
            organizationId: input.organizationId,
          },
        })
      );
    }

    return result;
  } finally {
    await revokeManageToken(db, {
      appointmentId: appt.id,
      token: token.data.token,
    });
  }
};

export const cancelPatientBooking = (
  db: DbConnection,
  input: CancelPatientBookingInput
) =>
  trackedResult(
    'patientBookings.cancelPatientBooking',
    async () => {
      const parsed = cancelPatientBookingSchema.safeParse(input);
      if (!parsed.success) {
        return err(
          new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
            issues: parsed.error.issues,
          })
        );
      }
      return cancelPatientBookingImpl(db, parsed.data);
    },
    {
      properties: {
        organizationId: input.organizationId,
        appointmentId: input.appointmentId,
      },
      internalErrorsOnly: true,
    }
  );

export type CancelPatientBookingResult = Awaited<
  ReturnType<typeof cancelPatientBooking>
>;
