import { withOrgScope } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';
import type { DbConnection } from '../../shared/index.js';
import type { SaleWithRelations } from '../models/sale.types.js';
import { completeSale } from '../services/complete-sale/complete-sale.service.js';
import { loadSaleWithRelations } from './load-sale.js';

/**
 * Auto-complete a sale the moment its succeeded tenders cover the total.
 *
 * Recording a payment and completing a sale are separate operations: a tender
 * only writes a `sale_payment` row and leaves `sale.status = 'open'`. Callers
 * (cash/gift-card tenders, and the async Stripe payment webhook) invoke this
 * after settling a payment so a fully-paid sale transitions to `completed`
 * without a manual "Complete sale" click — otherwise paid sales linger as
 * drafts and never surface on the Sales list.
 *
 * Best-effort: the payment is already captured, so a completion failure is
 * logged, never thrown. Returns the freshly-loaded `completed` sale when it
 * transitioned, or `null` when it did not (not open, or not yet fully paid).
 */
export const autoCompleteIfFullyPaid = async (
  db: DbConnection,
  input: { organizationId: string; saleId: string; createdById?: string }
): Promise<SaleWithRelations | null> => {
  const { organizationId, saleId, createdById } = input;

  const existing = await withOrgScope(
    (tx) => loadSaleWithRelations(tx, organizationId, saleId),
    { db }
  );
  if (!existing || existing.status !== 'open') return null;

  const paidCents = existing.payments
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amountCents, 0);

  // A €0 (comped) sale with no outstanding balance is fully paid — complete it
  // so it doesn't linger as an open draft. Only a negative total is bailed on
  // (a data bug we must not auto-complete).
  if (existing.totalCents < 0 || paidCents < existing.totalCents) return null;

  const result = await completeSale(db, {
    organizationId,
    saleId,
    createdById,
  });
  if (!result.success) {
    logError('sales.autoCompleteIfFullyPaid', new Error(result.error.message), {
      feature: 'sales',
      extra: { organizationId, saleId, code: result.error.code },
    });
    return null;
  }

  return withOrgScope(
    (tx) => loadSaleWithRelations(tx, organizationId, saleId),
    { db }
  );
};
