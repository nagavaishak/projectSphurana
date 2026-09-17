import { appointment, appointmentDeposit } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, lt } from 'drizzle-orm';
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
  type CheckExpiredDepositsInput,
  checkExpiredDepositsSchema,
} from './check-expired-deposits.schema.js';

export interface CheckExpiredDepositsResult {
  expiredCount: number;
  expiredDepositIds: string[];
}

/**
 * Check for and mark expired deposits
 * This is meant to be called by a scheduler (e.g., every 5 minutes)
 */
const checkExpiredDepositsImpl = async (
  db: DbConnection,
  input: CheckExpiredDepositsInput = {}
): Promise<Result<CheckExpiredDepositsResult>> => {
  const parsed = checkExpiredDepositsSchema.safeParse(input);
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

    // Find pending deposits that have expired
    const expiredDeposits = await db.query.appointmentDeposit.findMany({
      where: and(
        eq(appointmentDeposit.status, 'pending'),
        lt(appointmentDeposit.expiresAt, now)
      ),
      limit: batchSize,
    });

    if (expiredDeposits.length === 0) {
      return ok({
        expiredCount: 0,
        expiredDepositIds: [],
      });
    }

    const expiredDepositIds: string[] = [];

    // Process each expired deposit
    for (const deposit of expiredDeposits) {
      try {
        // Update deposit status to expired
        await db
          .update(appointmentDeposit)
          .set({
            status: 'expired',
            updatedAt: new Date(),
          })
          .where(eq(appointmentDeposit.id, deposit.id));

        // Cancel the appointment — an expired-deposit appointment never
        // happened; the deposit row itself keeps its own 'expired' status
        await db
          .update(appointment)
          .set({
            status: 'cancelled',
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(appointment.id, deposit.appointmentId),
              notDeleted(appointment)
            )
          );

        // …and the room goes with it: an expired-deposit appointment never
        // happened, so it must stop holding a treatment room. Missing this
        // leaves the hold in place forever — nothing revisits it. (See the
        // invariant in release-appointment-resources.ts.)
        const releasedResources = await releaseAppointmentResources(db, {
          appointmentId: deposit.appointmentId,
          organizationId: deposit.organizationId,
        });
        if (!releasedResources.success) {
          logError(
            'appointments.checkExpiredDeposits.releaseResources',
            new Error(releasedResources.error.message),
            {
              feature: 'appointments',
              extra: {
                depositId: deposit.id,
                appointmentId: deposit.appointmentId,
              },
            }
          );
        }

        expiredDepositIds.push(deposit.id);
      } catch (depositError) {
        // Log but continue processing other deposits
        logError(
          'appointments.checkExpiredDeposits.processDeposit',
          depositError,
          {
            feature: 'appointments',
            extra: {
              depositId: deposit.id,
              appointmentId: deposit.appointmentId,
            },
          }
        );
      }
    }

    return ok({
      expiredCount: expiredDepositIds.length,
      expiredDepositIds,
    });
  } catch (error) {
    logError('appointments.checkExpiredDeposits', error, {
      feature: 'appointments',
      extra: { batchSize },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to check expired deposits'
      )
    );
  }
};

/**
 * Check for and mark expired deposits
 */
export const checkExpiredDeposits = (
  db: DbConnection,
  input: CheckExpiredDepositsInput = {}
) =>
  trackedResult(
    'appointments.checkExpiredDeposits',
    () => checkExpiredDepositsImpl(db, input),
    {
      properties: {
        batchSize: input.batchSize ?? 50,
      },
      trackSuccess: false,
      trackFailure: false,
    }
  );
