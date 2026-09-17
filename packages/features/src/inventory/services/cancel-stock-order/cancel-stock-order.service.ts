import {
  type StockOrder,
  stockOrder,
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
import {
  type CancelStockOrderInput,
  cancelStockOrderSchema,
} from './cancel-stock-order.schema.js';

const cancelStockOrderImpl = async (
  db: DbConnection,
  input: CancelStockOrderInput
): Promise<Result<StockOrder>> => {
  const parsed = cancelStockOrderSchema.safeParse(input);
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
        const existing = await tx.query.stockOrder.findFirst({
          where: and(
            eq(stockOrder.id, id),
            eq(stockOrder.organizationId, organizationId)
          ),
        });

        if (!existing) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Stock order not found')
          );
        }

        if (existing.status === 'received' || existing.status === 'cancelled') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              `Cannot cancel a ${existing.status} stock order`
            )
          );
        }

        const [updated] = await tx
          .update(stockOrder)
          .set({ status: 'cancelled' })
          .where(eq(stockOrder.id, id))
          .returning();

        return ok(updated);
      },
      { db }
    );
  } catch (error) {
    logError('inventory.cancelStockOrder', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cancel stock order'
      )
    );
  }
};

export const cancelStockOrder = (
  db: DbConnection,
  input: CancelStockOrderInput
) =>
  trackedResult(
    'inventory.cancelStockOrder',
    () => cancelStockOrderImpl(db, input),
    { properties: { organizationId: input.organizationId, id: input.id } }
  );
