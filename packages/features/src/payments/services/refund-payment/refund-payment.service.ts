import {
  type Payment,
  payment,
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
  type RefundPaymentInput,
  refundPaymentSchema,
} from './refund-payment.schema.js';

export interface RefundPaymentResult {
  payment: Payment;
  refundId: string;
}

const refundPaymentImpl = async (
  db: DbConnection,
  input: RefundPaymentInput
): Promise<Result<RefundPaymentResult>> => {
  const parsed = refundPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { paymentId, organizationId, reason } = parsed.data;

  try {
    const existing = await withOrgScope(
      (tx) =>
        tx.query.payment.findFirst({
          where: (t, { and, eq: eqOp }) =>
            and(eqOp(t.id, paymentId), eqOp(t.organizationId, organizationId)),
        }),
      { db }
    );

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Payment not found'));
    }

    if (existing.status !== 'paid') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          `Cannot refund payment with status: ${existing.status}. Only paid payments can be refunded.`
        )
      );
    }

    if (!existing.stripePaymentIntentId) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Payment has no payment intent ID. Cannot process refund.'
        )
      );
    }

    const stripeConnect = getStripeConnectService();
    const refund = await stripeConnect.createRefund({
      connectedAccountId: existing.stripeConnectedAccountId,
      paymentIntentId: existing.stripePaymentIntentId,
      reason,
      // Deterministic key off the payment row id so a retried refund can't
      // double-refund the same tender.
      idempotencyKey: `payment-refund:${paymentId}`,
    });

    const [updatedPayment] = await withOrgScope(
      (tx) =>
        tx
          .update(payment)
          .set({
            status: 'refunded',
            refundedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(payment.id, paymentId))
          .returning(),
      { db }
    );

    return ok({
      payment: updatedPayment,
      refundId: refund.id,
    });
  } catch (error) {
    logError('payments.refundPayment', error, {
      feature: 'payments',
      extra: { paymentId, organizationId },
    });

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
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to refund payment')
    );
  }
};

export const refundPayment = (db: DbConnection, input: RefundPaymentInput) =>
  trackedResult('payments.refundPayment', () => refundPaymentImpl(db, input), {
    properties: {
      paymentId: input.paymentId,
      organizationId: input.organizationId,
    },
  });

export type RefundPaymentServiceResult = Awaited<
  ReturnType<typeof refundPayment>
>;
