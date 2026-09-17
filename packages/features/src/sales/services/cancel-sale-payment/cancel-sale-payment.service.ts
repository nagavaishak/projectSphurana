import { salePayment, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { SaleWithRelations } from '../../models/sale.types.js';
import { cancelStripeSideOfTenders } from '../../utils/cancel-pending-stripe-tenders.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import {
  type CancelSalePaymentInput,
  cancelSalePaymentSchema,
} from './cancel-sale-payment.schema.js';

/**
 * Abandon a still-`pending` Stripe tender the cashier gave up on — an unscanned
 * QR link, an uncollected terminal PI, or an unconfirmed manual-card PI they
 * closed out of. Cancels the Stripe side (so the customer can't pay a link the
 * cashier has moved on from) and flips the row to `failed`, which frees the
 * sale's remaining balance and stops the checkout poll.
 *
 * Idempotent: a tender that already settled (webhook won the race) or was
 * already abandoned is left untouched and the current sale is returned, so the
 * frontend can fire this on dialog dismissal without guarding against races.
 */
const cancelSalePaymentImpl = async (
  db: DbConnection,
  input: CancelSalePaymentInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = cancelSalePaymentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, salePaymentId } = parsed.data;

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

    // Only a still-pending tender can be abandoned. A settled/failed/refunded
    // row is a no-op — return the current sale so the caller stays idempotent.
    if (row.status === 'pending') {
      // Best-effort Stripe cancel OUTSIDE any transaction, then flip the row
      // guarded on `status = 'pending'` so a capture that landed in the race
      // window (row already `succeeded`) is never overwritten to `failed`.
      await cancelStripeSideOfTenders(db, organizationId, saleId, [row]);
      await withOrgScope(
        (tx) =>
          tx
            .update(salePayment)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(salePayment.id, salePaymentId),
                eq(salePayment.status, 'pending')
              )
            ),
        { db }
      );
    }

    const sale = await withOrgScope(
      (tx) => loadSaleWithRelations(tx, organizationId, saleId),
      { db }
    );
    if (!sale) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
    }
    return ok(sale as SaleWithRelations);
  } catch (error) {
    logError('sales.cancelSalePayment', error, {
      feature: 'sales',
      extra: { organizationId, saleId, salePaymentId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cancel sale payment'
      )
    );
  }
};

export const cancelSalePayment = (
  db: DbConnection,
  input: CancelSalePaymentInput
) =>
  trackedResult(
    'sales.cancelSalePayment',
    () => cancelSalePaymentImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        saleId: input.saleId,
        salePaymentId: input.salePaymentId,
      },
    }
  );

export type CancelSalePaymentResult = Awaited<
  ReturnType<typeof cancelSalePayment>
>;
