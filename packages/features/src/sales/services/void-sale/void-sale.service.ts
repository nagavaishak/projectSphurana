import {
  type Sale,
  sale,
  salePayment,
  withOrgScope,
} from '@borradh-workspace/database';
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
import { cancelPendingStripeTenders } from '../../utils/cancel-pending-stripe-tenders.js';
import { loadSaleWithRelations } from '../../utils/load-sale.js';
import { type VoidSaleInput, voidSaleSchema } from './void-sale.schema.js';

/**
 * Money this SALE captured, as opposed to money it merely credited.
 *
 * A `deposit` tender is neither taken nor refundable here: it records that an
 * appointment deposit, already settled with Stripe at booking time, was applied
 * to this sale. Voiding the sale does not un-take it — the deposit still
 * belongs to the appointment, and refunding it is the cancellation flow's job.
 * Counting it as a settled tender is what wedged the sale: `voidSale` refused,
 * and no refund path reaches a `salePayment` row that carries no payment intent
 * of its own, so the sale could never be closed by any route.
 */
const isCapturedTender = (p: { status: string; method: string }) =>
  p.status === 'succeeded' && p.method !== 'deposit';

const voidSaleImpl = async (
  db: DbConnection,
  input: VoidSaleInput
): Promise<Result<Sale>> => {
  const parsed = voidSaleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId } = parsed.data;

  try {
    // Preflight (short read) BEFORE any Stripe I/O: a sale is voidable only
    // while open and with no CAPTURED tender. That guarantees every remaining
    // tender is pending/failed or a deposit credit, so cancelling the Stripe
    // side below can never cancel money we've actually taken.
    const preflight = await withOrgScope(
      (tx) => loadSaleWithRelations(tx, organizationId, saleId),
      { db }
    );
    if (!preflight) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
    }
    if (preflight.status !== 'open') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Only an open sale can be voided'
        )
      );
    }
    if (preflight.payments.some(isCapturedTender)) {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'A sale with settled payments cannot be voided — refund it instead'
        )
      );
    }

    // Abandon the Stripe side of any still-pending tender BEFORE marking it
    // failed — otherwise a late capture on a voided sale is lost money.
    // Best-effort; runs outside any transaction (Stripe I/O).
    await cancelPendingStripeTenders(db, organizationId, saleId);

    const result = await withOrgScope(
      (outerTx) =>
        outerTx.transaction(async (tx) => {
          const existing = await loadSaleWithRelations(
            tx,
            organizationId,
            saleId
          );
          if (!existing) {
            return {
              error: new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'),
            };
          }
          if (existing.status !== 'open') {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Only an open sale can be voided'
              ),
            };
          }
          if (existing.payments.some(isCapturedTender)) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'A sale with settled payments cannot be voided — refund it instead'
              ),
            };
          }

          // Close any in-flight tender (unscanned QR / uncollected terminal)
          // so it doesn't linger as an open payment on the voided sale.
          await tx
            .update(salePayment)
            .set({ status: 'failed', updatedAt: new Date() })
            .where(
              and(
                eq(salePayment.saleId, saleId),
                eq(salePayment.status, 'pending')
              )
            );

          // Hand the deposit back. `uq_sale_payment_appointment_deposit` is a
          // unique index on appointment_deposit_id, and
          // `createSaleFromAppointment` treats ANY row referencing a deposit as
          // proof it was already spent — so a credit line left behind on a
          // voided sale burns that deposit for every future sale on the same
          // appointment, and the customer is asked for the full amount again.
          // That is the double-charge this PR exists to prevent.
          //
          // Deleted rather than failed: the sale never happened, so the credit
          // is not history worth keeping, and only removing the row frees the
          // unique slot. The appointment_deposit itself is untouched.
          await tx
            .delete(salePayment)
            .where(
              and(
                eq(salePayment.saleId, saleId),
                eq(salePayment.method, 'deposit')
              )
            );

          const [updated] = await tx
            .update(sale)
            .set({ status: 'voided', updatedAt: new Date() })
            .where(eq(sale.id, saleId))
            .returning();

          return { updated };
        }),
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as Sale);
  } catch (error) {
    logError('sales.voidSale', error, {
      feature: 'sales',
      extra: { organizationId, saleId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to void sale')
    );
  }
};

export const voidSale = (db: DbConnection, input: VoidSaleInput) =>
  trackedResult('sales.voidSale', () => voidSaleImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
    },
  });

export type VoidSaleResult = Awaited<ReturnType<typeof voidSale>>;
