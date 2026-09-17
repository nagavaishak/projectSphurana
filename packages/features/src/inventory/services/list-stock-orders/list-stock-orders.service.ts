import {
  type StockOrder,
  stockOrder,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnscoped,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListStockOrdersInput,
  listStockOrdersSchema,
} from './list-stock-orders.schema.js';

export interface ListStockOrdersResult {
  items: StockOrder[];
  total: number;
  limit: number;
  offset: number;
}

const listStockOrdersImpl = async (
  db: DbConnection,
  input: ListStockOrdersInput
): Promise<Result<ListStockOrdersResult>> => {
  const parsed = listStockOrdersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, supplierId, locationId, limit, offset } =
    parsed.data;

  const conditions: SQL[] = [eq(stockOrder.organizationId, organizationId)];
  if (status) conditions.push(eq(stockOrder.status, status));
  if (supplierId) conditions.push(eq(stockOrder.supplierId, supplierId));
  if (locationId)
    conditions.push(atLocationOrUnscoped(stockOrder.locationId, locationId));

  const whereClause = and(...conditions);

  try {
    const [items, countResult] = await withOrgScope(
      async (tx) => {
        const rows = await tx.query.stockOrder.findMany({
          where: whereClause,
          limit,
          offset,
          orderBy: [desc(stockOrder.createdAt)],
        });
        const [ct] = await tx
          .select({ total: count() })
          .from(stockOrder)
          .where(whereClause);
        return [rows, ct] as const;
      },
      { db }
    );

    return ok({ items, total: countResult.total, limit, offset });
  } catch (error) {
    logError('inventory.listStockOrders', error, {
      feature: 'inventory',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list stock orders')
    );
  }
};

export const listStockOrders = (
  db: DbConnection,
  input: ListStockOrdersInput
) =>
  trackedResult(
    'inventory.listStockOrders',
    () => listStockOrdersImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
