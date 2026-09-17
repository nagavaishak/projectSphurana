import {
  type Appointment,
  type Organization,
  appointment,
  organization,
  withPatientScope,
  withSystemScope,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';

export interface AuthorizedPatientAppointment {
  appointment: Appointment;
  /** Needed to drive the token-authenticated appointments services. */
  organizationSlug: string;
  /**
   * The full org row — already loaded for the slug, and the callers need its
   * cancellation/rescheduling policy fields, so hand it over rather than have
   * each mutation re-query the same row.
   */
  organization: Organization;
}

/**
 * Ownership gate for every patient-portal booking mutation.
 *
 * The appointment is fetched under `withPatientScope`: with RLS on, the
 * `patient_self` policy makes any row that is not the signed-in patient's own
 * literally invisible, so "not visible" and "does not exist" are the same
 * NOT_FOUND — a patient can never learn whether someone else's booking id is
 * real. The explicit leadId/organizationId filters are defense in depth for
 * when the RLS flag is off (dev/tests).
 *
 * The org slug is then resolved under system scope (the `organization` row is
 * not patient-owned) so callers can hand off to the token-authenticated
 * appointments services, which are the single writer for `appointment`.
 */
export const authorizePatientAppointment = async (
  db: DbConnection,
  input: { leadId: string; organizationId: string; appointmentId: string }
): Promise<Result<AuthorizedPatientAppointment>> => {
  const { leadId, organizationId, appointmentId } = input;

  const appt = await withPatientScope(
    { leadId, organizationId },
    (tx) =>
      tx.query.appointment.findFirst({
        where: and(
          eq(appointment.id, appointmentId),
          eq(appointment.leadId, leadId),
          eq(appointment.organizationId, organizationId),
          notDeleted(appointment)
        ),
      }),
    { db }
  );

  if (!appt) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Booking not found'));
  }

  const org = await withSystemScope(
    (tx) =>
      tx.query.organization.findFirst({
        where: eq(organization.id, organizationId),
      }),
    { db }
  );

  if (!org) {
    // The appointment's own org is gone — data integrity fault, not user error.
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Organization not found')
    );
  }

  return ok({
    appointment: appt,
    organizationSlug: org.slug,
    organization: org,
  });
};
