import { appointment } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
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
  type ExpireAppointmentHoldsInput,
  expireAppointmentHoldsSchema,
} from './expire-appointment-holds.schema.js';

export interface ExpireAppointmentHoldsResult {
  releasedCount: number;
  releasedAppointmentIds: string[];
}

/**
 * Release `held` appointments whose `holdExpiresAt` has passed.
 *
 * This is the generic half of what `checkExpiredDeposits` used to own alone.
 * The deposit flow drove expiry from `appointment_deposit.expiresAt`, so a hold
 * that took NO payment — Claire holding a slot while the customer decides — had
 * nothing to release it, and Claire's bookings blocked their slot forever.
 * Moving the clock onto the appointment makes both flavours of hold expire
 * through one path.
 *
 * Deposit-backed holds still expire via `expireAppointmentDeposit`, which also
 * settles the deposit row. Whichever runs first wins: this service only touches
 * rows still in `held`, and that one only touches deposits still `pending`, so
 * the loser is a no-op rather than a double-cancel.
 */
const expireAppointmentHoldsImpl = async (
  db: DbConnection,
  input: ExpireAppointmentHoldsInput = {}
): Promise<Result<ExpireAppointmentHoldsResult>> => {
  const parsed = expireAppointmentHoldsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { batchSize } = parsed.data;

  try {
    const now = new Date();

    const expired = await db.query.appointment.findMany({
      where: and(
        eq(appointment.status, 'held'),
        isNotNull(appointment.holdExpiresAt),
        lt(appointment.holdExpiresAt, now),
        notDeleted(appointment)
      ),
      // `organizationId` comes along for the resource release below — this
      // sweep is cross-org, so each row must free its own org's rooms.
      columns: { id: true, organizationId: true },
      limit: batchSize,
    });

    if (expired.length === 0) {
      return ok({ releasedCount: 0, releasedAppointmentIds: [] });
    }

    const releasedAppointmentIds: string[] = [];

    for (const row of expired) {
      // Re-check the status inside the write so a hold confirmed between the
      // read above and here is left alone. `holdExpiresAt` is cleared too:
      // a cancelled row keeping a stale clock would be re-picked every tick.
      const updated = await db
        .update(appointment)
        .set({
          status: 'cancelled',
          holdExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appointment.id, row.id),
            eq(appointment.status, 'held'),
            notDeleted(appointment)
          )
        )
        .returning({ id: appointment.id });

      if (updated.length === 0) continue;
      releasedAppointmentIds.push(row.id);

      // An expired hold that keeps its room is the worst version of this bug:
      // the slot looks free on the practitioner's diary (status is cancelled)
      // but every booking for it is refused because the room is still held.
      // (See the invariant in release-appointment-resources.ts.)
      const releasedResources = await releaseAppointmentResources(db, {
        appointmentId: row.id,
        organizationId: row.organizationId,
      });
      if (!releasedResources.success) {
        logError(
          'appointments.expireAppointmentHolds.releaseResources',
          new Error(releasedResources.error.message),
          {
            feature: 'appointments',
            extra: {
              appointmentId: row.id,
              organizationId: row.organizationId,
            },
          }
        );
      }
    }

    return ok({
      releasedCount: releasedAppointmentIds.length,
      releasedAppointmentIds,
    });
  } catch (error) {
    logError('appointments.expireAppointmentHolds', error, {
      feature: 'appointments',
      extra: { batchSize },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to expire appointment holds'
      )
    );
  }
};

export const expireAppointmentHolds = (
  db: DbConnection,
  input: ExpireAppointmentHoldsInput = {}
) =>
  trackedResult(
    'appointments.expireAppointmentHolds',
    () => expireAppointmentHoldsImpl(db, input),
    { trackSuccess: false }
  );

export type ExpireAppointmentHoldsServiceResult = Awaited<
  ReturnType<typeof expireAppointmentHolds>
>;
