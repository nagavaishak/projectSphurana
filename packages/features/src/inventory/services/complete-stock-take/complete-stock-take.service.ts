import {
  productStock,
  stockTake,
  stockTakeItem,
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
import type { StockTakeWithItems } from '../../models/inventory.types.js';
import {
  type CompleteStockTakeInput,
  completeStockTakeSchema,
} from './complete-stock-take.schema.js';

/**
 * Completes a stock take. Every counted item (countedQuantity not null) has
 * its counted quantity written into product_stock at the stock take's
 * location; uncounted items are left untouched.
 */
const completeStockTakeImpl = async (
  db: DbConnection,
  input: CompleteStockTakeInput
): Promise<Result<StockTakeWithItems>> => {
  const parsed = completeStockTakeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, organizationId } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const take = await tx.query.stockTake.findFirst({
          where: and(
            eq(stockTake.id, id),
            eq(stockTake.organizationId, organizationId)
          ),
        });

        if (!take) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Stock take not found')
          );
        }

        if (take.status !== 'in_progress') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              `Cannot complete a ${take.status} stock take`
            )
          );
        }

        const items = await tx.query.stockTakeItem.findMany({
          where: eq(stockTakeItem.stockTakeId, id),
        });

        if (take.locationId) {
          for (const item of items) {
            if (item.countedQuantity === null) continue;
            await tx
              .insert(productStock)
              .values({
                productId: item.productId,
                locationId: take.locationId,
                quantity: item.countedQuantity,
              })
              .onConflictDoUpdate({
                target: [productStock.productId, productStock.locationId],
                set: { quantity: item.countedQuantity },
              });
          }
        }

        const [updated] = await tx
          .update(stockTake)
          .set({ status: 'completed', completedAt: new Date() })
          .where(eq(stockTake.id, id))
          .returning();

        return ok({ ...updated, items });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.completeStockTake', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to complete stock take'
      )
    );
  }
};

export const completeStockTake = (
  db: DbConnection,
  input: CompleteStockTakeInput
) =>
  trackedResult(
    'inventory.completeStockTake',
    () => completeStockTakeImpl(db, input),
    { properties: { organizationId: input.organizationId, id: input.id } }
  );
