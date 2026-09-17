import { appointment, withPublicOrgScope } from '@borradh-workspace/database';
import { activeAppointmentStatuses } from '@borradh-workspace/labels';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CancellationPolicy,
  evaluateBookingPolicy,
} from '../../shared/cancellation-policy.js';
import { resolveManageToken } from '../../shared/resolve-manage-token.js';
import { notifyPractitionerCancellation } from '../notify-practitioner-cancellation/notify-practitioner-cancellation.service.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type CancelManagedAppointmentInput,
  cancelManagedAppointmentSchema,
} from './cancel-managed-appointment.schema.js';

/**
 * The patient cancels their own booking.
 *
 * The slot reopens with no extra work: `activeAppointmentStatuses` (which every
 * availability and overlap check filters on) excludes `cancelled`, so flipping
 * the status IS the reopen for the PRACTITIONER's diary.
 *
 * The ROOM is the one exception, and it is not optional. `appointment_resource`
 * carries no status of its own and the availability engine deliberately does
 * not join back to `appointment.status`, so a cancelled booking keeps holding
 * its room until the row is deleted. See the invariant in
 * release-appointment-resources.ts.
 *
 * A late cancellation is still a cancellation — we apply the status and report
 * the fee rather than refusing. See `cancellation-policy.ts` for why.
 */
const cancelManagedAppointmentImpl = async (
  db: DbConnection,
  input: CancelManagedAppointmentInput
): Promise<
  Result<{ appointmentId: string; policyAtCancellation: CancellationPolicy }>
> => {
  const parsed = cancelManagedAppointmentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { reason } = parsed.data;

  const resolved = await resolveManageToken(db, parsed.data);
  if (!resolved.success) return resolved;

  const { org, appointment: appt } = resolved.data;

  // The clinic's online-cancellation TOGGLE, which this path never consulted.
  // The portal enforced it; the manage link in every confirmation email did
  // not — so a clinic that switched online cancellation off was still being
  // cancelled on by anyone holding one. Same evaluator on both sides now.
  //
  // The notice window deliberately does NOT block here either: a late cancel
  // applies and reports its fee, which is what `policyAtCancellation` carries.
  const decision = evaluateBookingPolicy(org, 'cancel', appt.startDate);
  if (!decision.allowed) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        decision.deniedReason ?? 'Online cancellation is unavailable.'
      )
    );
  }

  const policy: CancellationPolicy = {
    noticeRequiredHours: decision.noticeRequiredHours,
    isWithinFreeWindow: decision.isWithinFreeWindow,
    lateFeeCents: decision.lateFeeCents,
  };

  // Guard the UPDATE on the status too, not just the read above. Two taps on a
  // flaky connection, or a patient cancelling while the clinic marks them
  // arrived, must not resurrect a terminal appointment as `cancelled`.
  const updated = await withPublicOrgScope(
    org.id,
    (tx) =>
      tx
        .update(appointment)
        .set({ status: 'cancelled' })
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
        'This booking can no longer be cancelled'
      )
    );
  }

  // Free the room(s). Best-effort for the same reason the notification below
  // is: the cancellation is committed and the patient must not be told it
  // failed. A leaked hold is visible on the rooms calendar; a patient
  // cancelling twice is not recoverable.
  const releasedResources = await withPublicOrgScope(
    org.id,
    (tx) =>
      releaseAppointmentResources(tx, {
        appointmentId: appt.id,
        organizationId: org.id,
      }),
    { db }
  );
  if (!releasedResources.success) {
    logError(
      'appointments.cancelManagedAppointment.releaseResources',
      new Error(releasedResources.error.message),
      {
        feature: 'appointments',
        extra: { appointmentId: appt.id, organizationId: org.id },
      }
    );
  }

  // Best-effort: the cancellation is already committed and the slot is already
  // free. A failed notification must not report the cancel as failed and tempt
  // the patient into cancelling twice.
  try {
    await notifyPractitionerCancellation(db, {
      appointmentId: appt.id,
      organizationId: org.id,
      cancellationReason: reason,
    });
  } catch (error) {
    logError('appointments.cancelManagedAppointment.notify', error, {
      feature: 'appointments',
      extra: { appointmentId: appt.id, organizationId: org.id },
    });
  }

  return ok({ appointmentId: appt.id, policyAtCancellation: policy });
};

export const cancelManagedAppointment = (
  db: DbConnection,
  input: CancelManagedAppointmentInput
) =>
  trackedResult(
    'appointments.cancelManagedAppointment',
    () => cancelManagedAppointmentImpl(db, input),
    { properties: { organizationSlug: input.organizationSlug } }
  );

export type CancelManagedAppointmentResult = Awaited<
  ReturnType<typeof cancelManagedAppointment>
>;
