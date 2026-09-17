import {
  type StockTake,
  stockTake,
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
  type CancelStockTakeInput,
  cancelStockTakeSchema,
} from './cancel-stock-take.schema.js';

const cancelStockTakeImpl = async (
  db: DbConnection,
  input: CancelStockTakeInput
): Promise<Result<StockTake>> => {
  const parsed = cancelStockTakeSchema.safeParse(input);
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
        const existing = await tx.query.stockTake.findFirst({
          where: and(
            eq(stockTake.id, id),
            eq(stockTake.organizationId, organizationId)
          ),
        });

        if (!existing) {
          return err(
            new FeatureError(ErrorCodes.NOT_FOUND, 'Stock take not found')
          );
        }

        if (existing.status !== 'in_progress') {
          return err(
            new FeatureError(
              ErrorCodes.INVALID_STATE,
              `Cannot cancel a ${existing.status} stock take`
            )
          );
        }

        const [updated] = await tx
          .update(stockTake)
          .set({ status: 'cancelled' })
          .where(eq(stockTake.id, id))
          .returning();

        return ok(updated);
      },
      { db }
    );
  } catch (error) {
    logError('inventory.cancelStockTake', error, {
      feature: 'inventory',
      extra: { organizationId, id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to cancel stock take')
    );
  }
};

export const cancelStockTake = (
  db: DbConnection,
  input: CancelStockTakeInput
) =>
  trackedResult(
    'inventory.cancelStockTake',
    () => cancelStockTakeImpl(db, input),
    { properties: { organizationId: input.organizationId, id: input.id } }
  );
