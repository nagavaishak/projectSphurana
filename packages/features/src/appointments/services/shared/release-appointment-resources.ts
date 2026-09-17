import { appointmentResource } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THE ALLOCATION LIFECYCLE INVARIANT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   An `appointment_resource` row exists ONLY while its appointment is active.
 *
 * `resolveResourceAvailability` — the query behind every slot list, every
 * availability check and every allocation decision — deliberately does NOT join
 * back to `appointment.status`. That is what lets it be a single indexed range
 * query instead of a join across the busiest table in the schema, and it is
 * only sound because of the invariant above.
 *
 * So: EVERY transition out of an active status must call this.
 *
 *   cancel · no-show · soft-delete · hold expiry · deposit expiry ·
 *   lead-hold release · deposit-checkout expiry · reschedule (release + re-hold)
 *
 * Miss one and the failure is silent and permanent: the appointment is gone
 * from the calendar, but its room is still held, forever, against every future
 * booking. Nobody reports "the room I cancelled is still busy" — they report
 * "we can't book Tuesdays any more", months later, and the clinic quietly loses
 * capacity in the meantime. There is no self-healing path; nothing ever revisits
 * an orphaned row.
 *
 * Deleting is the right shape rather than flagging: an allocation carries no
 * history worth keeping (the appointment already records what happened), and a
 * `released_at` column would put the status join straight back into the hot
 * query it was designed to avoid.
 *
 * Expects to already be inside an org scope (`withOrgScope` /
 * `withPublicOrgScope`) and never opens its own transaction, so it composes
 * with a caller's — a release and the status write it accompanies commit or
 * roll back together.
 */

export const releaseAppointmentResourcesSchema = z.object({
  appointmentId: z.string().min(1, 'Appointment ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ReleaseAppointmentResourcesInput = z.infer<
  typeof releaseAppointmentResourcesSchema
>;

export interface ReleaseAppointmentResourcesResult {
  releasedCount: number;
}

const releaseAppointmentResourcesImpl = async (
  db: DbConnection,
  input: ReleaseAppointmentResourcesInput
): Promise<Result<ReleaseAppointmentResourcesResult>> => {
  const parsed = releaseAppointmentResourcesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { appointmentId, organizationId } = parsed.data;

  try {
    // Idempotent by construction: releasing an appointment that holds nothing
    // deletes zero rows and succeeds. Every call site is therefore safe to run
    // twice, which matters because several of them (deposit expiry, hold
    // expiry) are retried queue jobs.
    const released = await db
      .delete(appointmentResource)
      .where(
        and(
          eq(appointmentResource.appointmentId, appointmentId),
          eq(appointmentResource.organizationId, organizationId)
        )
      )
      .returning({ id: appointmentResource.id });

    return ok({ releasedCount: released.length });
  } catch (error) {
    logError('appointments.releaseAppointmentResources', error, {
      feature: 'appointments',
      extra: { appointmentId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to release the resources held by this appointment'
      )
    );
  }
};

/**
 * Free every resource this appointment holds. See the invariant above.
 *
 * Returns a `Result` rather than throwing: on a cancel/delete path the status
 * change has already committed and refusing it afterwards would be worse than
 * the leak. Call sites log a failure loudly and continue — a leaked hold is
 * visible in the rooms calendar and recoverable; an un-cancelled appointment is
 * neither.
 */
export const releaseAppointmentResources = (
  db: DbConnection,
  input: ReleaseAppointmentResourcesInput
) =>
  trackedResult(
    'appointments.releaseAppointmentResources',
    () => releaseAppointmentResourcesImpl(db, input),
    {
      properties: {
        appointmentId: input.appointmentId,
        organizationId: input.organizationId,
      },
      trackSuccess: false,
    }
  );

export type ReleaseAppointmentResourcesServiceResult = Awaited<
  ReturnType<typeof releaseAppointmentResources>
>;
