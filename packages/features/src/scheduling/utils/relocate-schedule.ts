import { blockedTime, shift, timeOff } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Move a branch's rota, blocks and time off to another branch.
 *
 * All three tables are owned by `scheduling` (`shift` and `blocked_time` are
 * enforced by `architecture/single-writer.test.ts`; `time_off` is kept with
 * them because splitting one of the three across features is how the next
 * person misses it).
 *
 * These rows describe INTENT — who is expected to work, and when nobody can be
 * booked. Their FKs are `set null`, and for `blocked_time` / `time_off` NULL
 * already means something specific and much worse: "applies to EVERY branch".
 * So the cascade would not merely lose Cork's closures, it would impose them on
 * Dublin. Repointing at a real branch is the only answer that stays true.
 */
export const relocateSchedule = async (
  db: DbConnection,
  input: { fromLocationId: string; toLocationId: string }
): Promise<void> => {
  const { fromLocationId, toLocationId } = input;

  await db
    .update(shift)
    .set({ locationId: toLocationId })
    .where(eq(shift.locationId, fromLocationId));

  await db
    .update(blockedTime)
    .set({ locationId: toLocationId })
    .where(eq(blockedTime.locationId, fromLocationId));

  await db
    .update(timeOff)
    .set({ locationId: toLocationId })
    .where(eq(timeOff.locationId, fromLocationId));
};
