import { sale, salePayment } from '@borradh-workspace/database';
import { getStripeConnectService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { autoCompleteIfFullyPaid } from '../../utils/auto-complete-sale.js';
import {
  type HandleSalePaymentWebhookInput,
  handleSalePaymentWebhookSchema,
} from './handle-sale-payment-webhook.schema.js';

export interface HandleSalePaymentWebhookResult {
  processed: boolean;
  salePaymentId?: string;
  action: 'succeeded' | 'failed' | 'refunded' | 'ignored';
}

/**
 * Settles `sale_payment` rows from Stripe Connect webhook events. Covers both
 * tenders that settle asynchronously:
 *  - QR self-checkout (Payment Link → `checkout.session.*` / `charge.refunded`)
 *  - card-terminal / Tap to Pay (`payment_intent.succeeded` /
 *    `payment_intent.payment_failed`)
 *
 * Matches the row by `metadata.salePaymentId`, falling back to
 * `stripe_payment_intent_id` when the metadata is absent. Runs under
 * `withSystemScope` (webhooks have no org session) — the caller passes the
 * scoped connection. Idempotent: succeeded/failed transitions only apply to a
 * still-`pending` row.
 */
const handleSalePaymentWebhookImpl = async (
  db: DbConnection,
  input: HandleSalePaymentWebhookInput
): Promise<Result<HandleSalePaymentWebhookResult>> => {
  const parsed = handleSalePaymentWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    eventType,
    paymentIntentId,
    metadata,
    amountRefundedCents,
    amountCapturedCents,
  } = parsed.data;
  const metadataSalePaymentId = metadata?.salePaymentId;

  // Resolve the target row: prefer the explicit metadata id, fall back to the
  // PaymentIntent id (Terminal PIs always carry it on the row).
  if (!metadataSalePaymentId && !paymentIntentId) {
    return ok({ processed: false, action: 'ignored' });
  }

  try {
    const existing = metadataSalePaymentId
      ? await db.query.salePayment.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, metadataSalePaymentId),
        })
      : await db.query.salePayment.findFirst({
          where: (t, { eq: eqOp }) =>
            eqOp(t.stripePaymentIntentId, paymentIntentId as string),
        });

    if (!existing) {
      return ok({ processed: false, action: 'ignored' });
    }

    const salePaymentId = existing.id;

    if (
      eventType === 'checkout.session.completed' ||
      eventType === 'payment_intent.succeeded'
    ) {
      const piId = paymentIntentId ?? existing.stripePaymentIntentId;

      // Re-delivery of a tender we already recorded (same PI, same row) —
      // nothing to do. Only pending/failed rows transition from here.
      if (existing.status === 'succeeded' || existing.status === 'refunded') {
        return ok({ processed: false, salePaymentId, action: 'ignored' });
      }

      const saleRow = await db.query.sale.findFirst({
        columns: { totalCents: true, organizationId: true },
        where: (t, { eq: eqOp }) => eqOp(t.id, existing.saleId),
      });
      const organizationId =
        metadata?.organizationId ?? saleRow?.organizationId;

      // Refund a captured tender the sale did not need and record it `refunded`
      // so the books balance. Because the balance now counts ONLY captured money
      // (intents never block), two intents can both capture; the surplus one is
      // reconciled HERE — the only safe point, since Stripe can't un-capture on
      // request. Best-effort refund; the row is always marked refunded + alerted.
      const refundSurplus = async (reason: string): Promise<void> => {
        if (organizationId && piId) {
          const integration = await db.query.stripeConnectIntegration.findFirst(
            {
              where: (t, { eq: eqOp }) =>
                eqOp(t.organizationId, organizationId),
            }
          );
          if (integration) {
            try {
              await getStripeConnectService().createRefund({
                connectedAccountId: integration.stripeAccountId,
                paymentIntentId: piId,
              });
            } catch (error) {
              logError('sales.handleSalePaymentWebhook.refundSurplus', error, {
                feature: 'sales',
                extra: { salePaymentId, saleId: existing.saleId, piId },
              });
            }
          }
        }
        await db
          .update(salePayment)
          .set({
            status: 'refunded',
            refundedCents: existing.amountCents,
            stripePaymentIntentId: piId,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(salePayment.id, salePaymentId),
              ne(salePayment.status, 'refunded')
            )
          );
        logError(
          'sales.handleSalePaymentWebhook.surplusCaptureRefunded',
          new Error(
            `Sale tender captured money the sale did not need (${reason}) — auto-refunded`
          ),
          {
            feature: 'sales',
            extra: { salePaymentId, saleId: existing.saleId, reason },
          }
        );
      };

      // A tender abandoned on completion/void (`failed`) that still captured:
      // the sale is already settled, so this money is surplus.
      if (existing.status === 'failed') {
        await refundSurplus('paid-after-abandon');
        return ok({ processed: true, salePaymentId, action: 'refunded' });
      }

      // Record the capture: flip pending → succeeded (guarded, so a concurrent
      // delivery that already flipped it wins and we don't double-complete).
      const flipped = await db
        .update(salePayment)
        .set({
          status: 'succeeded',
          stripePaymentIntentId: piId,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(salePayment.id, salePaymentId),
            eq(salePayment.status, 'pending')
          )
        )
        .returning({ id: salePayment.id });

      if (flipped.length === 0) {
        return ok({ processed: false, salePaymentId, action: 'ignored' });
      }

      // Post-flip overpayment check: if OTHER succeeded tenders already cover the
      // sale, this capture is surplus (two tenders both settled) → refund it.
      // Checked AFTER the flip so a concurrently-settled sibling is counted.
      const payments = await db.query.salePayment.findMany({
        columns: { id: true, status: true, amountCents: true },
        where: (t, { eq: eqOp }) => eqOp(t.saleId, existing.saleId),
      });
      const total = saleRow?.totalCents ?? existing.amountCents;
      const paidByOthers = payments
        .filter((p) => p.status === 'succeeded' && p.id !== salePaymentId)
        .reduce((sum, p) => sum + p.amountCents, 0);
      if (paidByOthers >= total) {
        await refundSurplus('overpayment');
        return ok({ processed: true, salePaymentId, action: 'refunded' });
      }

      // Needed capture — no "Complete sale" click follows an async Stripe
      // settlement, so complete the sale now if it's fully covered.
      if (organizationId) {
        await autoCompleteIfFullyPaid(db, {
          organizationId,
          saleId: existing.saleId,
        });
      }

      return ok({ processed: true, salePaymentId, action: 'succeeded' });
    }

    if (eventType === 'payment_intent.payment_failed') {
      // Idempotent: only fail a still-pending row; leave settled ones alone.
      if (existing.status !== 'pending') {
        return ok({ processed: false, salePaymentId, action: 'ignored' });
      }
      await db
        .update(salePayment)
        .set({
          status: 'failed',
          stripePaymentIntentId:
            paymentIntentId ?? existing.stripePaymentIntentId,
          updatedAt: new Date(),
        })
        .where(eq(salePayment.id, salePaymentId));
      return ok({ processed: true, salePaymentId, action: 'failed' });
    }

    if (eventType === 'charge.refunded') {
      // Distinguish a FULL refund from a PARTIAL one. Only a full refund flips
      // the tender to `refunded`; a partial refund must NOT (it would drop the
      // whole amount from the day's collected total). With no amounts on the
      // event we assume full (legacy behavior).
      const fullyRefunded =
        amountCapturedCents != null && amountRefundedCents != null
          ? amountRefundedCents >= amountCapturedCents
          : true;

      // Record the money that actually went back. `sale_payment.refunded_cents`
      // EXISTS (notNull, default 0) — an earlier version of this handler assumed
      // it didn't and left it at 0, so a refunded tender reported `refunded` with
      // `refundedCents: 0` and the SALE stayed `completed` forever.
      const refundedCents = fullyRefunded
        ? (amountRefundedCents ?? existing.amountCents)
        : (amountRefundedCents ?? 0);

      await db
        .update(salePayment)
        .set({
          // A partial refund leaves the tender settled — zeroing it out of the
          // day's collected total would be wrong.
          status: fullyRefunded ? 'refunded' : existing.status,
          refundedCents,
          updatedAt: new Date(),
        })
        .where(eq(salePayment.id, salePaymentId));

      // Roll the SALE up from its tenders: a sale whose refunds cover the total
      // is `refunded`, one with some money back is `partially_refunded`.
      const payments = await db.query.salePayment.findMany({
        columns: { refundedCents: true },
        where: (t, { eq: eqOp }) => eqOp(t.saleId, existing.saleId),
      });
      const totalRefunded = payments.reduce(
        (sum, p) => sum + (p.refundedCents ?? 0),
        0
      );
      const saleRow = await db.query.sale.findFirst({
        columns: { totalCents: true },
        where: (t, { eq: eqOp }) => eqOp(t.id, existing.saleId),
      });

      if (saleRow && totalRefunded > 0) {
        await db
          .update(sale)
          .set({
            status:
              totalRefunded >= saleRow.totalCents
                ? 'refunded'
                : 'partially_refunded',
            updatedAt: new Date(),
          })
          .where(eq(sale.id, existing.saleId));
      }

      return ok({ processed: true, salePaymentId, action: 'refunded' });
    }

    // checkout.session.expired — the QR was never paid; leave pending rows
    // alone so the POS can retry, nothing to settle.
    return ok({ processed: false, salePaymentId, action: 'ignored' });
  } catch (error) {
    logError('sales.handleSalePaymentWebhook', error, {
      feature: 'sales',
      extra: {
        salePaymentId: metadataSalePaymentId,
        paymentIntentId,
        eventType,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to process sale payment webhook'
      )
    );
  }
};

export const handleSalePaymentWebhook = (
  db: DbConnection,
  input: HandleSalePaymentWebhookInput
) =>
  trackedResult(
    'sales.handleSalePaymentWebhook',
    () => handleSalePaymentWebhookImpl(db, input),
    {
      properties: {
        eventType: input.eventType,
        salePaymentId: input.metadata?.salePaymentId,
      },
    }
  );

export type HandleSalePaymentWebhookServiceResult = Awaited<
  ReturnType<typeof handleSalePaymentWebhook>
>;
