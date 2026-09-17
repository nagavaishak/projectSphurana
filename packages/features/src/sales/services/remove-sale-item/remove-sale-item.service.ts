import { saleItem, withOrgScope } from '@borradh-workspace/database';
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
import {
  loadSaleWithRelations,
  recomputeAndPersistTotals,
} from '../../utils/load-sale.js';
import { computeSaleTotals } from '../../utils/sale-totals.js';
import {
  type RemoveSaleItemInput,
  removeSaleItemSchema,
} from './remove-sale-item.schema.js';

const removeSaleItemImpl = async (
  db: DbConnection,
  input: RemoveSaleItemInput
): Promise<Result<SaleWithRelations>> => {
  const parsed = removeSaleItemSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId, itemId } = parsed.data;

  try {
    const result = await withOrgScope(
      async (tx) => {
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
              'Items can only be removed from an open sale'
            ),
          };
        }
        if (!existing.items.some((item) => item.id === itemId)) {
          return {
            error: new FeatureError(
              ErrorCodes.NOT_FOUND,
              'Sale item not found'
            ),
          };
        }

        // Guard against dropping the total below what's already been settled:
        // removing this item can't leave the sale over-paid AND open (which
        // would strand it — you can neither refund nor complete cleanly).
        const succeededPaidCents = existing.payments
          .filter((p) => p.status === 'succeeded')
          .reduce((sum, p) => sum + p.amountCents, 0);
        if (succeededPaidCents > 0) {
          const remainingItems = existing.items.filter((i) => i.id !== itemId);
          const prospective = computeSaleTotals(remainingItems, existing);
          if (prospective.totalCents < succeededPaidCents) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Removing this item would drop the total below the amount already paid — refund a payment first'
              ),
            };
          }
        }

        await tx
          .delete(saleItem)
          .where(and(eq(saleItem.id, itemId), eq(saleItem.saleId, saleId)));

        const updated = await recomputeAndPersistTotals(tx, existing);
        return { updated };
      },
      { db }
    );

    if (result.error) return err(result.error);
    return ok(result.updated as SaleWithRelations);
  } catch (error) {
    logError('sales.removeSaleItem', error, {
      feature: 'sales',
      extra: { organizationId, saleId, itemId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to remove sale item')
    );
  }
};

export const removeSaleItem = (db: DbConnection, input: RemoveSaleItemInput) =>
  trackedResult('sales.removeSaleItem', () => removeSaleItemImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      saleId: input.saleId,
      itemId: input.itemId,
    },
  });

export type RemoveSaleItemResult = Awaited<ReturnType<typeof removeSaleItem>>;
