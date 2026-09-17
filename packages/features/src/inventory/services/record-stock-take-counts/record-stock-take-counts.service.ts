import {
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
  type RecordStockTakeCountsInput,
  recordStockTakeCountsSchema,
} from './record-stock-take-counts.schema.js';

const recordStockTakeCountsImpl = async (
  db: DbConnection,
  input: RecordStockTakeCountsInput
): Promise<Result<StockTakeWithItems>> => {
  const parsed = recordStockTakeCountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { stockTakeId, organizationId, items: counts } = parsed.data;

  try {
    return await withOrgScope(
      async (tx) => {
        const take = await tx.query.stockTake.findFirst({
          where: and(
            eq(stockTake.id, stockTakeId),
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
              `Cannot record counts on a ${take.status} stock take`
            )
          );
        }

        for (const countEntry of counts) {
          const [updated] = await tx
            .update(stockTakeItem)
            .set({ countedQuantity: countEntry.countedQuantity })
            .where(
              and(
                eq(stockTakeItem.id, countEntry.itemId),
                eq(stockTakeItem.stockTakeId, stockTakeId)
              )
            )
            .returning();

          if (!updated) {
            return err(
              new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Stock take item not found'
              )
            );
          }
        }

        const items = await tx.query.stockTakeItem.findMany({
          where: eq(stockTakeItem.stockTakeId, stockTakeId),
        });

        return ok({ ...take, items });
      },
      { db }
    );
  } catch (error) {
    logError('inventory.recordStockTakeCounts', error, {
      feature: 'inventory',
      extra: { organizationId, stockTakeId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to record counts')
    );
  }
};

export const recordStockTakeCounts = (
  db: DbConnection,
  input: RecordStockTakeCountsInput
) =>
  trackedResult(
    'inventory.recordStockTakeCounts',
    () => recordStockTakeCountsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        stockTakeId: input.stockTakeId,
      },
    }
  );
