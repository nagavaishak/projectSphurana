import { appointment } from '@borradh-workspace/database';
import { and, eq, gte } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Move a branch's FUTURE appointments to another branch.
 *
 * Written here rather than at the caller because `appointment` is owned by this
 * feature (`architecture/single-writer.test.ts`): a raw
 * `db.update(appointment)` from another feature is exactly the shape that test
 * exists to stop, and "what happens to a diary when its branch closes" is an
 * appointments question even though a location delete is what asks it.
 *
 * FUTURE ONLY, and that boundary is the point. A past appointment is trading
 * history — restamping it would move one branch's completed work onto another
 * branch's books — so `deleteLocation` REFUSES rather than calls this when any
 * exist. A future appointment is intent, and intent has to land on a real
 * branch or it becomes invisible to every strict-`eq` list service.
 *
 * Takes a `DbConnection` so it joins the caller's transaction; the location row
 * and everything pointing at it must commit together.
 */
export const relocateFutureAppointments = async (
  db: DbConnection,
  input: { fromLocationId: string; toLocationId: string; notBefore: Date }
): Promise<void> => {
  await db
    .update(appointment)
    .set({ locationId: input.toLocationId })
    .where(
      and(
        eq(appointment.locationId, input.fromLocationId),
        gte(appointment.endDate, input.notBefore)
      )
    );
};
