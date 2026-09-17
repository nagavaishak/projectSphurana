import {
  type AppointmentDeposit,
  appointmentDeposit,
  withOrgScope,
} from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RefundDepositInput,
  refundDepositSchema,
} from './refund-deposit.schema.js';

export interface RefundDepositResult {
  deposit: AppointmentDeposit;
  refundId: string;
}

/**
 * Refund a paid deposit
 */
const refundDepositImpl = async (
  db: DbConnection,
  input: RefundDepositInput
): Promise<Result<RefundDepositResult>> => {
  const parsed = refundDepositSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { depositId, organizationId, reason } = parsed.data;

  try {
    // Get the deposit
    const deposit = await db.query.appointmentDeposit.findFirst({
      where: (t, { and, eq: eqOp }) =>
        and(eqOp(t.id, depositId), eqOp(t.organizationId, organizationId)),
    });

    if (!deposit) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Deposit not found'));
    }

    if (deposit.status !== 'paid') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          `Cannot refund deposit with status: ${deposit.status}. Only paid deposits can be refunded.`
        )
      );
    }

    if (!deposit.stripePaymentIntentId) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Deposit has no payment intent ID. Cannot process refund.'
        )
      );
    }

    // Create refund via Stripe
    const stripeConnect = getStripeConnectService();
    const refund = await stripeConnect.createRefund({
      connectedAccountId: deposit.stripeConnectedAccountId,
      paymentIntentId: deposit.stripePaymentIntentId,
      reason,
      // Deterministic key off the deposit row id so a retried refund can't
      // double-refund the same deposit.
      idempotencyKey: `deposit-refund:${depositId}`,
    });

    // Update deposit status
    const [updatedDeposit] = await db
      .update(appointmentDeposit)
      .set({
        status: 'refunded',
        refundedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(appointmentDeposit.id, depositId))
      .returning();

    return ok({
      deposit: updatedDeposit,
      refundId: refund.id,
    });
  } catch (error) {
    logError('appointments.refundDeposit', error, {
      feature: 'appointments',
      extra: { depositId, organizationId },
    });

    // Check for Stripe-specific errors
    const stripeError = error as { type?: string; message?: string };
    if (stripeError.type === 'StripeInvalidRequestError') {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          stripeError.message || 'Stripe refund failed'
        )
      );
    }

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to refund deposit')
    );
  }
};

/**
 * Refund a paid deposit
 */
export const refundDeposit = (db: DbConnection, input: RefundDepositInput) =>
  trackedResult(
    'appointments.refundDeposit',
    () => withOrgScope((tx) => refundDepositImpl(tx, input), { db }),
    {
      properties: {
        depositId: input.depositId,
        organizationId: input.organizationId,
      },
    }
  );
