import { product } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Deactivate products whose ONLY selling branch has been deleted.
 *
 * `product` is not on the single-writer list, but this sits beside its own
 * table for the same reason the others do: "what does it mean for a product
 * when the only shop that stocked it closes" is an inventory decision, and
 * keeping the five withdrawals symmetrical is what stops the next one being
 * written inline and getting it wrong. Zero rows in `product_location` means
 * "sold everywhere" (`shared/location-scope.ts`).
 */
export const withdrawProducts = async (
  db: DbConnection,
  productIds: string[]
): Promise<void> => {
  if (productIds.length === 0) return;

  await db
    .update(product)
    .set({ isActive: false })
    .where(inArray(product.id, productIds));
};
