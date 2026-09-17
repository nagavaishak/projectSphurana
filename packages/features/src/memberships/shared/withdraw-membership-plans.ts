import { membershipPlan } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Deactivate membership plans whose ONLY branch has been deleted.
 *
 * Lives in the owning feature (`membershipPlan` is single-writer, see
 * `architecture/single-writer.test.ts`). Same reasoning as
 * `withdrawServices`: zero rows in `membership_plan_location` reads as "sold
 * everywhere", so a plan cannot be un-sold by removing its last link row.
 */
export const withdrawMembershipPlans = async (
  db: DbConnection,
  planIds: string[]
): Promise<void> => {
  if (planIds.length === 0) return;

  await db
    .update(membershipPlan)
    .set({ isActive: false })
    .where(inArray(membershipPlan.id, planIds));
};
