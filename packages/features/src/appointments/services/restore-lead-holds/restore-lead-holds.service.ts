import { appointment } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
import {
  asResourceFeatureError,
  reallocateAppointmentResources,
} from '../shared/allocate-appointment-resources.js';
import {
  type RestoreLeadHoldsInput,
  restoreLeadHoldsSchema,
} from './restore-lead-holds.schema.js';

export interface RestoreLeadHoldsResult {
  restoredCount: number;
}

/**
 * Put back holds that `releaseLeadHolds` cancelled, with their original clocks.
 *
 * The compensating half of "release the old hold before taking the new one".
 * That order is forced — `held` is an active status and `appointment_no_overlap`
 * is enforced in the database, so releasing afterwards would make a customer
 * re-picking the SAME slot collide with their own hold — but it means a booking
 * that then fails has already given the old slot away. Without this the customer
 * ends up holding nothing: the original reservation cancelled, the new one
 * refused.
 *
 * Only revives rows still `cancelled`, so a slot someone else has since taken,
 * or one an operator has since rebooked, is never yanked back out from under
 * them. Per-row and best-effort for the same reason: losing the race on one
 * hold should not abandon the rest.
 */
const restoreLeadHoldsImpl = async (
  db: DbConnection,
  input: RestoreLeadHoldsInput
): Promise<Result<RestoreLeadHoldsResult>> => {
  const parsed = restoreLeadHoldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, holds } = parsed.data;
  if (holds.length === 0) return ok({ restoredCount: 0 });

  let restoredCount = 0;

  for (const hold of holds) {
    try {
      const restored = await db
        .update(appointment)
        .set({
          status: 'held',
          holdExpiresAt: hold.holdExpiresAt,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appointment.id, hold.id),
            eq(appointment.organizationId, organizationId),
            // Still cancelled — anything else means the row moved on without us.
            eq(appointment.status, 'cancelled'),
            notDeleted(appointment)
          )
        )
        .returning({ id: appointment.id });

      if (restored.length === 0) continue;
      restoredCount += restored.length;

      // The INVERSE of the release invariant: a hold that is active again must
      // hold its room again, or the slot reads as bookable to the room gate
      // while the diary shows it taken. Warn-don't-block — this is already a
      // compensating action for a booking that failed, and refusing it would
      // leave the lead holding nothing at all.
      try {
        await reallocateAppointmentResources(db, {
          appointmentId: hold.id,
          organizationId,
        });
      } catch (error) {
        const featureError = asResourceFeatureError(error);
        if (!featureError) throw error;
        logError(
          'appointments.restoreLeadHolds.reallocateResources',
          new Error(featureError.message),
          {
            feature: 'appointments',
            extra: { organizationId, appointmentId: hold.id },
          }
        );
      }
    } catch (error) {
      // The slot may have been taken in the gap, which is the one case this
      // cannot win. Log it and carry on rather than masking the booking
      // failure the caller is already reporting.
      logError('appointments.restoreLeadHolds', error, {
        feature: 'appointments',
        extra: { organizationId, appointmentId: hold.id },
      });
    }
  }

  return ok({ restoredCount });
};

export const restoreLeadHolds = (
  db: DbConnection,
  input: RestoreLeadHoldsInput
) =>
  trackedResult(
    'appointments.restoreLeadHolds',
    () => restoreLeadHoldsImpl(db, input),
    { trackSuccess: false }
  );

export type RestoreLeadHoldsServiceResult = Awaited<
  ReturnType<typeof restoreLeadHolds>
>;
