import { stockOrder, withOrgScope } from '@borradh-workspace/database';
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
import type { StockOrderWithItems } from '../../models/inventory.types.js';
import {
  type GetStockOrderInput,
  getStockOrderSchema,
} from './get-stock-order.schema.js';

const getStockOrderImpl = async (
  db: DbConnection,
  input: GetStockOrderInput
): Promise<Result<StockOrderWithItems>> => {
  const parsed = getStockOrderSchema.safeParse(input);
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
        tx.query.stockOrder.findFirst({
          where: and(
            eq(stockOrder.id, parsed.data.id),
            eq(stockOrder.organizationId, parsed.data.organizationId)
          ),
          with: { items: true, fees: true },
        }),
      { db }
    );

    if (!row) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Stock order not found')
      );
    }

    return ok(row as StockOrderWithItems);
  } catch (error) {
    logError('inventory.getStockOrder', error, {
      feature: 'inventory',
      extra: { organizationId: parsed.data.organizationId, id: parsed.data.id },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to get stock order')
    );
  }
};

export const getStockOrder = (db: DbConnection, input: GetStockOrderInput) =>
  trackedResult('inventory.getStockOrder', () => getStockOrderImpl(db, input), {
    properties: { organizationId: input.organizationId, id: input.id },
    internalErrorsOnly: true,
  });
