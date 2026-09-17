import { appointment } from '@borradh-workspace/database';
import type {
  AppointmentStatus,
  ConsentFormSubmissionStatus,
} from '@borradh-workspace/labels';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * Appointment states that make a still-PENDING consent form MOOT — the visit
 * it was issued for is not going to happen, so the patient must not be nudged
 * to sign it and must not be able to sign it.
 *
 * Derived at READ time rather than stamped onto the submission at cancel time.
 * That is deliberate: `PUT /appointments/:id` accepts any `status`, so staff
 * can un-cancel a booking, and a stored "voided" flag would then be silently
 * wrong until something remembered to clear it. A derived answer is correct on
 * every path — cancel, un-cancel, soft-delete, restore — with no backfill and
 * no new enum value.
 *
 * Only `cancelled` is listed. `no_show` and `completed` describe a visit that
 * DID reach its slot: an unsigned form there is a real compliance gap the
 * clinic still wants chased, not noise to hide.
 */
export const CONSENT_MOOTING_APPOINTMENT_STATUSES: readonly AppointmentStatus[] =
  ['cancelled'];

/** The only appointment columns the moot check needs. */
export interface ConsentAppointmentState {
  status: AppointmentStatus;
  deletedAt: Date | null;
}

/**
 * Should this submission be hidden from the patient portal?
 *
 * Mirrors the split `releasePendingConsentForms` already makes on hard delete:
 *
 *   pending   → moot once the appointment is cancelled or soft-deleted.
 *   completed → NEVER moot. It is an executed legal instrument; the patient
 *               keeps seeing (and downloading) what they signed, whatever
 *               later happens to the appointment.
 *
 * An appointment we could not read is treated as live. Hiding a form on the
 * strength of a row we failed to load would turn a transient read problem into
 * a patient silently never being asked to consent.
 */
export function isPendingFormMoot(
  submissionStatus: ConsentFormSubmissionStatus,
  appointmentState: ConsentAppointmentState | undefined
): boolean {
  if (submissionStatus !== 'pending') return false;
  if (!appointmentState) return false;
  if (appointmentState.deletedAt !== null) return true;
  return CONSENT_MOOTING_APPOINTMENT_STATUSES.includes(appointmentState.status);
}

/**
 * Load the state of one submission's appointment. Call INSIDE the caller's
 * patient scope — `appointment` carries a `patient_self` policy, so the row is
 * visible to `app_patient` exactly when it is the patient's own.
 */
export async function loadConsentAppointmentState(
  tx: DbConnection,
  input: { appointmentId: string; organizationId: string }
): Promise<ConsentAppointmentState | undefined> {
  const row = await tx.query.appointment.findFirst({
    where: and(
      eq(appointment.id, input.appointmentId),
      eq(appointment.organizationId, input.organizationId)
    ),
    columns: { status: true, deletedAt: true },
  });

  return row ?? undefined;
}

/** Same, for a list — one query keyed by appointment id. */
export async function loadConsentAppointmentStates(
  tx: DbConnection,
  input: { appointmentIds: string[]; organizationId: string }
): Promise<Map<string, ConsentAppointmentState>> {
  if (input.appointmentIds.length === 0) return new Map();

  const rows = await tx.query.appointment.findMany({
    where: and(
      inArray(appointment.id, input.appointmentIds),
      eq(appointment.organizationId, input.organizationId)
    ),
    columns: { id: true, status: true, deletedAt: true },
  });

  return new Map(
    rows.map((row) => [
      row.id,
      { status: row.status, deletedAt: row.deletedAt },
    ])
  );
}
