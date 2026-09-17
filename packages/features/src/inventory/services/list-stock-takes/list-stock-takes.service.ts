import {
  type StockTake,
  stockTake,
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
  type ListStockTakesInput,
  listStockTakesSchema,
} from './list-stock-takes.schema.js';

export interface ListStockTakesResult {
  items: StockTake[];
  total: number;
  limit: number;
  offset: number;
}

const listStockTakesImpl = async (
  db: DbConnection,
  input: ListStockTakesInput
): Promise<Result<ListStockTakesResult>> => {
  const parsed = listStockTakesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, locationId, limit, offset } = parsed.data;

  const conditions: SQL[] = [eq(stockTake.organizationId, organizationId)];
  if (status) conditions.push(eq(stockTake.status, status));
  if (locationId)
    conditions.push(atLocationOrUnscoped(stockTake.locationId, locationId));

  const whereClause = and(...conditions);

  try {
    const [items, countResult] = await withOrgScope(
      async (tx) => {
        const rows = await tx.query.stockTake.findMany({
          where: whereClause,
          limit,
          offset,
          orderBy: [desc(stockTake.createdAt)],
        });
        const [ct] = await tx
          .select({ total: count() })
          .from(stockTake)
          .where(whereClause);
        return [rows, ct] as const;
      },
      { db }
    );

    return ok({ items, total: countResult.total, limit, offset });
  } catch (error) {
    logError('inventory.listStockTakes', error, {
      feature: 'inventory',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list stock takes')
    );
  }
};

export const listStockTakes = (db: DbConnection, input: ListStockTakesInput) =>
  trackedResult(
    'inventory.listStockTakes',
    () => listStockTakesImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );
