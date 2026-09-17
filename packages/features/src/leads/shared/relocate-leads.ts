import { lead } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Repoint every customer whose HOME branch is being deleted at another branch.
 *
 * Lives in the owning feature because `lead` is single-writer
 * (`architecture/single-writer.test.ts`).
 *
 * The FK is `set null`, and null is not a neutral value here: `GET /leads`
 * reads it as "no home branch yet", so a whole branch's customer list would
 * quietly re-file itself as unassigned with nothing left to recover the
 * original branch from. Repointing keeps the customer attached to a real place.
 */
export const relocateLeadHomeBranch = async (
  db: DbConnection,
  input: { fromLocationId: string; toLocationId: string }
): Promise<void> => {
  await db
    .update(lead)
    .set({ primaryLocationId: input.toLocationId })
    .where(eq(lead.primaryLocationId, input.fromLocationId));
};
