import type { Sale, SaleItem } from '@borradh-workspace/database';

/**
 * Compute subtotal / tip / total for a sale from its items and tip settings.
 * tip_cents is always the settled amount (source of truth); tip_percent is
 * only meaningful when tipType === 'percent'.
 */
export const computeSaleTotals = (
  items: Pick<SaleItem, 'totalCents'>[],
  tip: Pick<Sale, 'tipType' | 'tipPercent' | 'tipCents'>
): { subtotalCents: number; tipCents: number; totalCents: number } => {
  const subtotalCents = items.reduce((sum, item) => sum + item.totalCents, 0);

  let tipCents = 0;
  if (tip.tipType === 'percent') {
    tipCents = Math.round((subtotalCents * (tip.tipPercent ?? 0)) / 100);
  } else if (tip.tipType === 'amount') {
    tipCents = tip.tipCents;
  }

  return { subtotalCents, tipCents, totalCents: subtotalCents + tipCents };
};
