import { sale, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, eq, gte, lt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnscoped,
  currencyForCountry,
  err,
  ok,
} from '../../../shared/index.js';
import type {
  SaleDailySummary,
  SaleWithRelations,
} from '../../models/sale.types.js';
import {
  type GetDailySummaryInput,
  getDailySummarySchema,
} from './get-daily-summary.schema.js';

const getDailySummaryImpl = async (
  db: DbConnection,
  input: GetDailySummaryInput
): Promise<Result<SaleDailySummary>> => {
  const parsed = getDailySummarySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, date, locationId } = parsed.data;

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const conditions: SQL[] = [
    eq(sale.organizationId, organizationId),
    eq(sale.status, 'completed'),
    gte(sale.completedAt, dayStart),
    lt(sale.completedAt, dayEnd),
  ];
  if (locationId)
    conditions.push(atLocationOrUnscoped(sale.locationId, locationId));

  const { sales, currency } = await withOrgScope(
    async (tx) => {
      const rows = (await tx.query.sale.findMany({
        where: and(...conditions),
        with: { items: true, payments: true },
      })) as SaleWithRelations[];
      // Currency comes from the org's primary location country (no org currency
      // setting), matching create-sale so every surface renders the same symbol.
      const primaryLocation = await tx.query.organizationLocation.findFirst({
        where: (t, { and: andOp, eq: eqOp }) =>
          andOp(
            eqOp(t.organizationId, organizationId),
            eqOp(t.isPrimary, true)
          ),
      });
      const cur = currencyForCountry(
        primaryLocation?.country ?? null
      ).code.toLowerCase();
      return { sales: rows, currency: cur };
    },
    { db }
  );

  const byMethod: Record<string, number> = {};
  const byItemType: Record<string, number> = {};
  const itemRows: SaleDailySummary['itemRows'] = {};
  const methodRows: SaleDailySummary['methodRows'] = {};
  let totalCents = 0;
  let tipCents = 0;

  const methodRow = (method: string) => {
    const existing = methodRows[method];
    if (existing) return existing;
    const created = { collectedCents: 0, refundsCents: 0 };
    methodRows[method] = created;
    return created;
  };
  const itemRow = (itemType: string) => {
    const existing = itemRows[itemType];
    if (existing) return existing;
    const created = { salesQty: 0, refundQty: 0, grossCents: 0 };
    itemRows[itemType] = created;
    return created;
  };

  for (const s of sales) {
    totalCents += s.totalCents;
    tipCents += s.tipCents;
    for (const p of s.payments) {
      if (p.status === 'succeeded') {
        byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountCents;
        methodRow(p.method).collectedCents += p.amountCents;
      } else if (p.status === 'refunded') {
        // A refunded tender was still COLLECTED before it was refunded — count
        // the gross in collected AND record the refund, rather than dropping
        // the whole tender out of the day's takings. (When a partial-refund
        // column exists, refunds should read that amount; today a `refunded`
        // status means a full refund.)
        byMethod[p.method] = (byMethod[p.method] ?? 0) + p.amountCents;
        methodRow(p.method).collectedCents += p.amountCents;
        methodRow(p.method).refundsCents += p.amountCents;
      }
    }
    for (const item of s.items) {
      byItemType[item.itemType] =
        (byItemType[item.itemType] ?? 0) + item.totalCents;
      const row = itemRow(item.itemType);
      row.salesQty += item.quantity;
      row.grossCents += item.totalCents;
    }
  }

  return ok({
    date,
    currency,
    saleCount: sales.length,
    totalCents,
    tipCents,
    byMethod,
    byItemType,
    itemRows,
    methodRows,
  });
};

export const getDailySummary = (
  db: DbConnection,
  input: GetDailySummaryInput
) =>
  trackedResult('sales.getDailySummary', () => getDailySummaryImpl(db, input), {
    properties: { organizationId: input.organizationId, date: input.date },
  });

export type GetDailySummaryResult = Awaited<ReturnType<typeof getDailySummary>>;
