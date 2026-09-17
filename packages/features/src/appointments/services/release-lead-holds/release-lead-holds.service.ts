import { appointment } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type ReleaseLeadHoldsInput,
  releaseLeadHoldsSchema,
} from './release-lead-holds.schema.js';

export interface ReleasedHold {
  id: string;
  holdExpiresAt: Date | null;
}

export interface ReleaseLeadHoldsResult {
  releasedCount: number;
  /**
   * The rows this call cancelled, carrying the clock each one had BEFORE the
   * release. Enough to put them back exactly as they were — see
   * `restoreLeadHolds`. Captured by reading first, because `UPDATE … RETURNING`
   * hands back the new values, and by then `holdExpiresAt` is already null.
   */
  released: ReleasedHold[];
}

/**
 * Cancel a lead's outstanding `held` appointments.
 *
 * Enforces "one live hold per lead": a customer who says "actually, can I do
 * Thursday instead?" should not end up sitting on two slots. Without this a
 * chat that wanders across a few options silently reserves all of them, and
 * every one blocks the calendar until its clock runs out.
 *
 * Only touches `held` rows, so a real booking — or one already confirmed by
 * payment — is never withdrawn.
 */
const releaseLeadHoldsImpl = async (
  db: DbConnection,
  input: ReleaseLeadHoldsInput
): Promise<Result<ReleaseLeadHoldsResult>> => {
  const parsed = releaseLeadHoldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, exceptAppointmentId } = parsed.data;

  const scope = and(
    eq(appointment.leadId, leadId),
    eq(appointment.organizationId, organizationId),
    eq(appointment.status, 'held'),
    exceptAppointmentId ? ne(appointment.id, exceptAppointmentId) : undefined,
    notDeleted(appointment)
  );

  try {
    // Read before writing: the caller may need to undo this, and the clock is
    // gone from the returned row once the update has nulled it.
    const before = await db.query.appointment.findMany({
      where: scope,
      columns: { id: true, holdExpiresAt: true },
    });

    const released = await db
      .update(appointment)
      .set({ status: 'cancelled', holdExpiresAt: null, updatedAt: new Date() })
      .where(scope)
      .returning({ id: appointment.id });

    const releasedIds = new Set(released.map((r) => r.id));

    // Free the rooms those holds were sitting on. A hold that is cancelled but
    // still allocated blocks its slot for everyone while showing as free on the
    // diary. (See the invariant in release-appointment-resources.ts.)
    for (const appointmentId of releasedIds) {
      const releasedResources = await releaseAppointmentResources(db, {
        appointmentId,
        organizationId,
      });
      if (!releasedResources.success) {
        logError(
          'appointments.releaseLeadHolds.releaseResources',
          new Error(releasedResources.error.message),
          { feature: 'appointments', extra: { appointmentId, organizationId } }
        );
      }
    }

    return ok({
      releasedCount: released.length,
      released: before.filter((b) => releasedIds.has(b.id)),
    });
  } catch (error) {
    logError('appointments.releaseLeadHolds', error, {
      feature: 'appointments',
      extra: { organizationId, leadId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to release holds')
    );
  }
};

export const releaseLeadHolds = (
  db: DbConnection,
  input: ReleaseLeadHoldsInput
) =>
  trackedResult(
    'appointments.releaseLeadHolds',
    () => releaseLeadHoldsImpl(db, input),
    { trackSuccess: false }
  );

export type ReleaseLeadHoldsServiceResult = Awaited<
  ReturnType<typeof releaseLeadHolds>
>;
