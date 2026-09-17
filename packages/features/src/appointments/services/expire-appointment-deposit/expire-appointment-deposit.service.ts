import { appointment, appointmentDeposit } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type ExpireAppointmentDepositInput,
  expireAppointmentDepositSchema,
} from './expire-appointment-deposit.schema.js';

interface ExpireAppointmentDepositResult {
  expired: boolean;
}

/**
 * Expire a single pending deposit and cancel its appointment. Runs as one BullMQ
 * job per deposit so a spike of expirations drains at worker concurrency rather
 * than a fixed per-tick batch.
 *
 * Idempotent: locks the deposit row (SELECT … FOR UPDATE) and only acts while it
 * is still 'pending', so duplicate/retry jobs — and any concurrent Stripe
 * completed/expired webhook — cannot double-process or fight over the row.
 */
const expireAppointmentDepositImpl = async (
  db: DbConnection,
  input: ExpireAppointmentDepositInput
): Promise<Result<ExpireAppointmentDepositResult>> => {
  const parsed = expireAppointmentDepositSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      }),
    };
  }

  const { depositId } = parsed.data;

  return db.transaction(async (tx) => {
    const [deposit] = await tx
      .select()
      .from(appointmentDeposit)
      .where(eq(appointmentDeposit.id, depositId))
      .for('update')
      .limit(1);

    if (!deposit || deposit.status !== 'pending') {
      // Already resolved (paid/expired/refunded) or gone — idempotent no-op.
      return ok({ expired: false });
    }

    await tx
      .update(appointmentDeposit)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(eq(appointmentDeposit.id, deposit.id));

    // Cancel the appointment — an expired-deposit appointment never happened;
    // the deposit row keeps its own 'expired' status (no information lost).
    //
    // The hold clock is cleared with it. Every other transition out of `held`
    // clears it (handle-deposit-webhook, release-lead-holds,
    // expire-appointment-holds), and a live-looking timestamp left on a
    // cancelled row is the kind of thing a later reader takes for meaningful.
    await tx
      .update(appointment)
      .set({ status: 'cancelled', holdExpiresAt: null, updatedAt: new Date() })
      .where(
        and(eq(appointment.id, deposit.appointmentId), notDeleted(appointment))
      );

    // …and the room goes with it. Runs on `tx`, so the release and the cancel
    // commit together — an expired deposit can never leave a cancelled booking
    // still holding a treatment room. (See the invariant in
    // release-appointment-resources.ts.)
    const releasedResources = await releaseAppointmentResources(tx, {
      appointmentId: deposit.appointmentId,
      organizationId: deposit.organizationId,
    });
    if (!releasedResources.success) {
      logError(
        'appointments.expireAppointmentDeposit.releaseResources',
        new Error(releasedResources.error.message),
        {
          feature: 'appointments',
          extra: {
            depositId: deposit.id,
            appointmentId: deposit.appointmentId,
            organizationId: deposit.organizationId,
          },
        }
      );
    }

    return ok({ expired: true });
  });
};

export const expireAppointmentDeposit = (
  db: DbConnection,
  input: ExpireAppointmentDepositInput
) =>
  trackedResult(
    'appointments.expireAppointmentDeposit',
    () => expireAppointmentDepositImpl(db, input),
    { trackSuccess: false, trackFailure: false }
  );

export type ExpireAppointmentDepositServiceResult = Awaited<
  ReturnType<typeof expireAppointmentDeposit>
>;
