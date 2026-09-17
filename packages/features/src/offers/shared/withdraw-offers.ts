import { offer } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Withdraw promotions whose ONLY branch has been deleted.
 *
 * `offer` has no `isActive` — its lifecycle is the `state` enum — and picking
 * the right member of that enum is precisely the domain knowledge that belongs
 * in this feature rather than in the location-delete path. `paused` is the
 * withdrawn-but-restorable state: `draft` would claim the promotion was never
 * published, and `expired` would claim it ran its course.
 *
 * Needed because zero rows in `offer_location` means "runs at every branch"
 * (`shared/location-scope.ts`), so a branch-exclusive promotion cannot be
 * retired by dropping its last link row — that publishes it chain-wide.
 */
export const withdrawOffers = async (
  db: DbConnection,
  offerIds: string[]
): Promise<void> => {
  if (offerIds.length === 0) return;

  await db
    .update(offer)
    .set({ state: 'paused' })
    .where(inArray(offer.id, offerIds));
};
