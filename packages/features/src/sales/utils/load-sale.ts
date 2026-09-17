import { sale, saleItem, salePayment } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';
import type { SaleWithRelations } from '../models/sale.types.js';
import { computeSaleTotals } from './sale-totals.js';

/** Load a sale with items + payments, scoped to the org. Null when missing. */
export const loadSaleWithRelations = async (
  tx: DbConnection,
  organizationId: string,
  saleId: string
): Promise<SaleWithRelations | null> => {
  const result = await tx.query.sale.findFirst({
    where: (t, { and: andOp, eq: eqOp }) =>
      andOp(eqOp(t.id, saleId), eqOp(t.organizationId, organizationId)),
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
  return (result as SaleWithRelations | undefined) ?? null;
};

/**
 * Recompute a sale's subtotal / tip / total from its current items and
 * persist. Returns the fresh SaleWithRelations.
 */
export const recomputeAndPersistTotals = async (
  tx: DbConnection,
  existing: SaleWithRelations
): Promise<SaleWithRelations> => {
  const items = await tx.query.saleItem.findMany({
    where: eq(saleItem.saleId, existing.id),
  });

  const totals = computeSaleTotals(items, existing);

  const [updated] = await tx
    .update(sale)
    .set({
      subtotalCents: totals.subtotalCents,
      tipCents: totals.tipCents,
      totalCents: totals.totalCents,
      updatedAt: new Date(),
    })
    .where(eq(sale.id, existing.id))
    .returning();

  const payments = await tx.query.salePayment.findMany({
    where: eq(salePayment.saleId, existing.id),
  });

  // Spread over `existing` — the bare .returning() row has leadId but no
  // lead/location/createdBy relations, which wipes the client card in the
  // checkout cache when returned alone.
  return {
    ...existing,
    ...(updated ?? {}),
    items,
    payments,
  } as SaleWithRelations;
};
