import { appointment, appointmentDeposit } from '@borradh-workspace/database';
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
import { notifyDepositPaid } from '../notify-deposit-paid/notify-deposit-paid.service.js';
import { releaseAppointmentResources } from '../shared/release-appointment-resources.js';
import {
  type HandleDepositWebhookInput,
  handleDepositWebhookSchema,
} from './handle-deposit-webhook.schema.js';

export interface HandleDepositWebhookResult {
  processed: boolean;
  depositId?: string;
  action?: 'paid' | 'expired' | 'refunded' | 'ignored';
}

/**
 * Handle Stripe Connect webhook events for deposits
 */
const handleDepositWebhookImpl = async (
  db: DbConnection,
  input: HandleDepositWebhookInput
): Promise<Result<HandleDepositWebhookResult>> => {
  const parsed = handleDepositWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid webhook input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { eventType, checkoutSessionId, paymentIntentId } = parsed.data;

  try {
    switch (eventType) {
      case 'checkout.session.completed':
        return handleCheckoutCompleted(db, checkoutSessionId, paymentIntentId);

      case 'checkout.session.expired':
        return handleCheckoutExpired(db, checkoutSessionId);

      case 'charge.refunded':
        return handleChargeRefunded(db, paymentIntentId);

      default:
        return ok({ processed: false, action: 'ignored' });
    }
  } catch (error) {
    logError('appointments.handleDepositWebhook', error, {
      feature: 'appointments',
      extra: { eventType, checkoutSessionId, paymentIntentId },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to process webhook')
    );
  }
};

/**
 * Handle checkout.session.completed - Mark deposit as paid.
 *
 * Runs in a transaction that locks the deposit row (SELECT … FOR UPDATE) before
 * reading its status. Stripe can deliver duplicate events, and a
 * completed/expired pair for the same session can arrive concurrently; the lock
 * serializes them so the status guard is atomic. A second processor blocks until
 * the first commits, then re-reads a non-'pending' status and ignores — no
 * interleaving into an indeterminate paid-but-cancelled state.
 */
async function handleCheckoutCompleted(
  db: DbConnection,
  checkoutSessionId?: string,
  paymentIntentId?: string
): Promise<Result<HandleDepositWebhookResult>> {
  if (!checkoutSessionId) {
    return ok({ processed: false, action: 'ignored' });
  }

  return db.transaction(async (tx) => {
    const [deposit] = await tx
      .select()
      .from(appointmentDeposit)
      .where(eq(appointmentDeposit.stripeCheckoutSessionId, checkoutSessionId))
      .for('update')
      .limit(1);

    if (!deposit) {
      return ok({ processed: false, action: 'ignored' });
    }

    if (deposit.status !== 'pending') {
      // Already processed (or being processed) — idempotent no-op.
      return ok({ processed: false, depositId: deposit.id, action: 'ignored' });
    }

    await tx
      .update(appointmentDeposit)
      .set({
        status: 'paid',
        stripePaymentIntentId: paymentIntentId || null,
        paidAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appointmentDeposit.id, deposit.id));

    // Deposit paid — the booking is now confirmed, and the hold clock is
    // cleared so `expireAppointmentHolds` can never release a paid slot.
    await tx
      .update(appointment)
      .set({
        status: 'confirmed',
        holdExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(appointment.id, deposit.appointmentId), notDeleted(appointment))
      );

    // Notify the clinic that the deposit was paid (fire-and-forget).
    notifyDepositPaid(db, { depositId: deposit.id }).catch((error) =>
      logError('appointments.handleDepositWebhook.notifyDepositPaid', error, {
        feature: 'appointments',
        extra: { depositId: deposit.id },
      })
    );

    return ok({ processed: true, depositId: deposit.id, action: 'paid' });
  });
}

/**
 * Handle checkout.session.expired - Mark deposit as expired. Locks the deposit
 * row so it cannot interleave with a concurrent completed event (see
 * handleCheckoutCompleted).
 */
async function handleCheckoutExpired(
  db: DbConnection,
  checkoutSessionId?: string
): Promise<Result<HandleDepositWebhookResult>> {
  if (!checkoutSessionId) {
    return ok({ processed: false, action: 'ignored' });
  }

  return db.transaction(async (tx) => {
    const [deposit] = await tx
      .select()
      .from(appointmentDeposit)
      .where(eq(appointmentDeposit.stripeCheckoutSessionId, checkoutSessionId))
      .for('update')
      .limit(1);

    if (!deposit) {
      return ok({ processed: false, action: 'ignored' });
    }

    if (deposit.status !== 'pending') {
      // Already processed (e.g. paid won the race) — idempotent no-op.
      return ok({ processed: false, depositId: deposit.id, action: 'ignored' });
    }

    await tx
      .update(appointmentDeposit)
      .set({
        status: 'expired',
        updatedAt: new Date(),
      })
      .where(eq(appointmentDeposit.id, deposit.id));

    // Cancel the appointment — an expired-deposit appointment never happened;
    // the deposit row keeps its own 'expired' status (no information lost)
    await tx
      .update(appointment)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(eq(appointment.id, deposit.appointmentId), notDeleted(appointment))
      );

    // …and the room goes with it. On `tx`, so the release commits with the
    // cancel. Stripe retries this webhook, and the release is idempotent, so a
    // redelivery is harmless. (See the invariant in
    // release-appointment-resources.ts.)
    const releasedResources = await releaseAppointmentResources(tx, {
      appointmentId: deposit.appointmentId,
      organizationId: deposit.organizationId,
    });
    if (!releasedResources.success) {
      logError(
        'appointments.handleDepositWebhook.releaseResources',
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

    return ok({ processed: true, depositId: deposit.id, action: 'expired' });
  });
}

/**
 * Handle charge.refunded - Mark deposit as refunded (if not already). Locks the
 * deposit row so duplicate refund events are idempotent.
 */
async function handleChargeRefunded(
  db: DbConnection,
  paymentIntentId?: string
): Promise<Result<HandleDepositWebhookResult>> {
  if (!paymentIntentId) {
    return ok({ processed: false, action: 'ignored' });
  }

  return db.transaction(async (tx) => {
    const [deposit] = await tx
      .select()
      .from(appointmentDeposit)
      .where(eq(appointmentDeposit.stripePaymentIntentId, paymentIntentId))
      .for('update')
      .limit(1);

    if (!deposit) {
      return ok({ processed: false, action: 'ignored' });
    }

    if (deposit.status === 'refunded') {
      // Already refunded (possibly via our API) — idempotent no-op.
      return ok({ processed: false, depositId: deposit.id, action: 'ignored' });
    }

    await tx
      .update(appointmentDeposit)
      .set({
        status: 'refunded',
        refundedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appointmentDeposit.id, deposit.id));

    return ok({ processed: true, depositId: deposit.id, action: 'refunded' });
  });
}

/**
 * Handle Stripe Connect webhook events for deposits
 */
export const handleDepositWebhook = (
  db: DbConnection,
  input: HandleDepositWebhookInput
) =>
  trackedResult(
    'appointments.handleDepositWebhook',
    () => handleDepositWebhookImpl(db, input),
    {
      properties: {
        eventType: input.eventType,
        checkoutSessionId: input.checkoutSessionId,
        paymentIntentId: input.paymentIntentId,
      },
    }
  );
