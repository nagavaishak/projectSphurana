import { sale, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, count, desc, eq, gte, lte } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnscoped,
  err,
  ok,
} from '../../../shared/index.js';
import type { SaleWithRelations } from '../../models/sale.types.js';
import { type ListSalesInput, listSalesSchema } from './list-sales.schema.js';

export interface ListSalesResult {
  items: SaleWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

const listSalesImpl = async (
  db: DbConnection,
  input: ListSalesInput
): Promise<Result<ListSalesResult>> => {
  const parsed = listSalesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    from,
    to,
    status,
    leadId,
    locationId,
    limit,
    offset,
  } = parsed.data;

  const conditions: SQL[] = [eq(sale.organizationId, organizationId)];
  if (from) conditions.push(gte(sale.createdAt, from));
  if (to) conditions.push(lte(sale.createdAt, to));
  if (status) conditions.push(eq(sale.status, status));
  if (leadId) conditions.push(eq(sale.leadId, leadId));
  if (locationId)
    conditions.push(atLocationOrUnscoped(sale.locationId, locationId));

  const whereClause = and(...conditions);

  const [items, countResult] = await withOrgScope(
    async (tx) => {
      const rows = await tx.query.sale.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(sale.createdAt)],
        with: {
          items: true,
          payments: true,
          lead: {
            columns: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          location: { columns: { id: true, name: true } },
          createdBy: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      });
      const [ct] = await tx
        .select({ total: count() })
        .from(sale)
        .where(whereClause);
      return [rows, ct] as const;
    },
    { db }
  );

  return ok({
    items: items as SaleWithRelations[],
    total: countResult.total,
    limit,
    offset,
  });
};

export const listSales = (db: DbConnection, input: ListSalesInput) =>
  trackedResult('sales.listSales', () => listSalesImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      status: input.status,
    },
  });

export type ListSalesServiceResult = Awaited<ReturnType<typeof listSales>>;
