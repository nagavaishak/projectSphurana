import { stockTake, withOrgScope } from '@borradh-workspace/database';
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
  type GetStockTakeInput,
  getStockTakeSchema,
} from './get-stock-take.schema.js';

const getStockTakeImpl = async (
  db: DbConnection,
  input: GetStockTakeInput
): Promise<Result<StockTakeWithItems>> => {
  const parsed = getStockTakeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const row = await withOrgScope(
      (tx) =>
        tx.query.stockTake.findFirst({
          where: and(
            eq(stockTake.id, parsed.data.id),
            eq(stockTake.organizationId, parsed.data.organizationId)
          ),
          with: { items: true },
        }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Stock take not found')
      );
    }

    return ok(row as StockTakeWithItems);
  } catch (error) {
    logError('inventory.getStockTake', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId, id: parsed.data.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get stock take')
    );
  }
};

export const getStockTake = (db: DbConnection, input: GetStockTakeInput) =>
  trackedResult('inventory.getStockTake', () => getStockTakeImpl(db, input), {
    properties: { organizationId: input.organizationId, id: input.id },
    internalErrorsOnly: true,
  });
