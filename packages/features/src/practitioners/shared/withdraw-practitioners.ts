import { practitioner } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Mark practitioners inactive because the only branch they worked at is gone.
 *
 * Lives in the owning feature (`architecture/single-writer.test.ts` enforces
 * one writer for `practitioner`), and the decision is this feature's to make:
 *
 * `practitioner_location` follows the "zero rows means EVERY branch" rule
 * (`shared/location-scope.ts`), so a Cork-only practitioner whose last link row
 * is removed does not become unbookable — they become bookable at every branch
 * in the chain. Deactivating them says the true thing instead, and it is
 * deliberately NOT "move them to the primary branch": inventing availability
 * for a person at a site they never worked is the same bug in the other
 * direction. Nothing is deleted; one toggle brings them back.
 */
export const withdrawPractitioners = async (
  db: DbConnection,
  practitionerIds: string[]
): Promise<void> => {
  if (practitionerIds.length === 0) return;

  await db
    .update(practitioner)
    .set({ isActive: false })
    .where(inArray(practitioner.id, practitionerIds));
};
