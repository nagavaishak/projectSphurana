import { salePayment, withOrgScope } from '@borradh-workspace/database';
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
import type { SaleWithRelations } from '../../models/sale.types.js';
import { autoCompleteIfFullyPaid } from '../../utils/auto-complete-sale.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import {
  type SettleCardPaymentInput,
  settleCardPaymentSchema,
} from './settle-card-payment.schema.js';

/**
 * Settle a manual-card tender right after Stripe Elements confirms it, instead
 * of waiting for the async `payment_intent.succeeded` webhook (which may be
 * delayed or, in local dev, not forwarded at all). Verifies the PaymentIntent
 * status with Stripe before flipping the row to `succeeded`, then auto-completes
 * the sale so the checkout closes. Idempotent and safe alongside the webhook —
 * both only settle a still-`pending` row.
 */
const settleCardPaymentImpl = async (
  db: DbConnection,
  input: SettleCardPaymentInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = settleCardPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, salePaymentId, createdById } = parsed.data;

  try {
    const row = await withOrgScope(
      (tx) =>
        tx.query.salePayment.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.id, salePaymentId),
        }),
      { db }
    );

    if (!row || row.saleId !== saleId) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Payment not found'));
    }

    // Already settled (e.g. the webhook won the race) — just make sure the sale
    // is completed and return it.
    if (row.status === 'succeeded') {
      const completed = await autoCompleteIfFullyPaid(db, {
        organizationId,
        saleId,
        createdById,
      });
      const sale =
        completed ??
        (await withOrgScope(
          (tx) => loadSaleWithRelations(tx, organizationId, saleId),
          { db }
        ));
      return ok(sale as SaleWithRelations);
    }

    if (row.status !== 'pending' || row.method !== 'manual_card') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Payment is not awaiting card confirmation'
        )
      );
    }
    if (!row.stripePaymentIntentId) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Payment has no associated card charge'
        )
      );
    }

    const integration = await withOrgScope(
      (tx) =>
        tx.query.stripeConnectIntegration.findFirst({
          where: (t, { eq: eqOp }) => eqOp(t.organizationId, organizationId),
        }),
      { db }
    );
    if (!integration) {
      return err(
        new FeatureError(ErrorCodes.INVALID_STATE, 'Stripe is not connected')
      );
    }

    // Verify with Stripe before trusting the client — only settle a genuinely
    // succeeded PaymentIntent.
    const stripeConnect = getStripeConnectService();
    const intent = await stripeConnect.retrievePaymentIntentStatus(
      integration.stripeAccountId,
      row.stripePaymentIntentId
    );

    if (intent.status !== 'succeeded') {
      // Not captured yet — leave the row pending; the webhook will settle it.
      const sale = await withOrgScope(
        (tx) => loadSaleWithRelations(tx, organizationId, saleId),
        { db }
      );
      return ok(sale as SaleWithRelations);
    }

    // Overpayment guard: the card captured, but if the sale is ALREADY covered
    // by other succeeded tenders (a sibling tender settled first), this capture
    // is surplus — refund it and record it `refunded` rather than overpay. Same
    // reconciliation the webhook applies; done here too because this fast-path
    // flips the row itself (the webhook re-delivery would see it already
    // settled). Stripe can't un-capture on request, so refunding is the only
    // safe resolution.
    const saleForCheck = await withOrgScope(
      (tx) => loadSaleWithRelations(tx, organizationId, saleId),
      { db }
    );
    const paidByOthers = (saleForCheck?.payments ?? [])
      .filter((p) => p.status === 'succeeded' && p.id !== salePaymentId)
      .reduce((sum, p) => sum + p.amountCents, 0);
    const total = saleForCheck?.totalCents ?? row.amountCents;
    if (paidByOthers >= total) {
      try {
        await stripeConnect.createRefund({
          connectedAccountId: integration.stripeAccountId,
          paymentIntentId: row.stripePaymentIntentId,
        });
      } catch (error) {
        logError('sales.settleCardPayment.refundSurplus', error, {
          feature: 'sales',
          extra: { organizationId, saleId, salePaymentId },
        });
      }
      await withOrgScope(
        (tx) =>
          tx
            .update(salePayment)
            .set({
              status: 'refunded',
              refundedCents: row.amountCents,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(salePayment.id, salePaymentId),
                ne(salePayment.status, 'refunded')
              )
            ),
        { db }
      );
      logError(
        'sales.settleCardPayment.surplusCaptureRefunded',
        new Error(
          'Manual card captured money the sale did not need — auto-refunded'
        ),
        {
          feature: 'sales',
          extra: { organizationId, saleId, salePaymentId, paidByOthers, total },
        }
      );
      const refundedSale = await withOrgScope(
        (tx) => loadSaleWithRelations(tx, organizationId, saleId),
        { db }
      );
      return ok(refundedSale as SaleWithRelations);
    }

    await withOrgScope(
      (tx) =>
        tx
          .update(salePayment)
          .set({ status: 'succeeded', updatedAt: new Date() })
          .where(eq(salePayment.id, salePaymentId)),
      { db }
    );

    const completed = await autoCompleteIfFullyPaid(db, {
      organizationId,
      saleId,
      createdById,
    });
    const sale =
      completed ??
      (await withOrgScope(
        (tx) => loadSaleWithRelations(tx, organizationId, saleId),
        { db }
      ));
    return ok(sale as SaleWithRelations);
  } catch (error) {
    logError('sales.settleCardPayment', error, {
      feature: 'sales',
      extra: { organizationId, saleId, salePaymentId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to settle card payment'
      )
    );
  }
};

export const settleCardPayment = (
  db: DbConnection,
  input: SettleCardPaymentInput
) =>
  trackedResult(
    'sales.settleCardPayment',
    () => settleCardPaymentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        saleId: input.saleId,
        salePaymentId: input.salePaymentId,
      },
    }
  );

export type SettleCardPaymentResult = Awaited<
  ReturnType<typeof settleCardPayment>
>;
