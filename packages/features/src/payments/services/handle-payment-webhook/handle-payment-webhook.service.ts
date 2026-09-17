import { payment } from '@borradh-workspace/database';
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
  type HandlePaymentWebhookInput,
  handlePaymentWebhookSchema,
} from './handle-payment-webhook.schema.js';

export interface HandlePaymentWebhookResult {
  processed: boolean;
  paymentId?: string;
  action?: 'paid' | 'expired' | 'refunded' | 'ignored';
}

const handlePaymentWebhookImpl = async (
  db: DbConnection,
  input: HandlePaymentWebhookInput
): Promise<Result<HandlePaymentWebhookResult>> => {
  const parsed = handlePaymentWebhookSchema.safeParse(input);
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
    logError('payments.handlePaymentWebhook', error, {
      feature: 'payments',
      extra: { eventType, checkoutSessionId, paymentIntentId },
    });

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to process webhook')
    );
  }
};

async function handleCheckoutCompleted(
  db: DbConnection,
  checkoutSessionId?: string,
  paymentIntentId?: string
): Promise<Result<HandlePaymentWebhookResult>> {
  if (!checkoutSessionId) {
    return ok({ processed: false, action: 'ignored' });
  }

  const existing = await db.query.payment.findFirst({
    where: (t, { eq: eqOp }) =>
      eqOp(t.stripeCheckoutSessionId, checkoutSessionId),
  });

  if (!existing) {
    return ok({ processed: false, action: 'ignored' });
  }

  if (existing.status !== 'pending') {
    return ok({
      processed: false,
      paymentId: existing.id,
      action: 'ignored',
    });
  }

  await db
    .update(payment)
    .set({
      status: 'paid',
      stripePaymentIntentId: paymentIntentId || null,
      paidAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payment.id, existing.id));

  return ok({ processed: true, paymentId: existing.id, action: 'paid' });
}

async function handleCheckoutExpired(
  db: DbConnection,
  checkoutSessionId?: string
): Promise<Result<HandlePaymentWebhookResult>> {
  if (!checkoutSessionId) {
    return ok({ processed: false, action: 'ignored' });
  }

  const existing = await db.query.payment.findFirst({
    where: (t, { eq: eqOp }) =>
      eqOp(t.stripeCheckoutSessionId, checkoutSessionId),
  });

  if (!existing) {
    return ok({ processed: false, action: 'ignored' });
  }

  if (existing.status !== 'pending') {
    return ok({
      processed: false,
      paymentId: existing.id,
      action: 'ignored',
    });
  }

  await db
    .update(payment)
    .set({
      status: 'expired',
      updatedAt: new Date(),
    })
    .where(eq(payment.id, existing.id));

  return ok({ processed: true, paymentId: existing.id, action: 'expired' });
}

async function handleChargeRefunded(
  db: DbConnection,
  paymentIntentId?: string
): Promise<Result<HandlePaymentWebhookResult>> {
  if (!paymentIntentId) {
    return ok({ processed: false, action: 'ignored' });
  }

  const existing = await db.query.payment.findFirst({
    where: (t, { eq: eqOp }) => eqOp(t.stripePaymentIntentId, paymentIntentId),
  });

  if (!existing) {
    return ok({ processed: false, action: 'ignored' });
  }

  if (existing.status === 'refunded') {
    return ok({
      processed: false,
      paymentId: existing.id,
      action: 'ignored',
    });
  }

  await db
    .update(payment)
    .set({
      status: 'refunded',
      refundedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(payment.id, existing.id));

  return ok({ processed: true, paymentId: existing.id, action: 'refunded' });
}

export const handlePaymentWebhook = (
  db: DbConnection,
  input: HandlePaymentWebhookInput
) =>
  trackedResult(
    'payments.handlePaymentWebhook',
    () => handlePaymentWebhookImpl(db, input),
    {
      properties: {
        eventType: input.eventType,
        checkoutSessionId: input.checkoutSessionId,
        paymentIntentId: input.paymentIntentId,
      },
    }
  );

export type HandlePaymentWebhookServiceResult = Awaited<
  ReturnType<typeof handlePaymentWebhook>
>;
