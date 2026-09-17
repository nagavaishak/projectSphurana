import { organizationService } from '@borradh-workspace/database';
import { inArray } from 'drizzle-orm';
import type { DbConnection } from '../../shared/index.js';

/**
 * Deactivate services whose ONLY branch has been deleted.
 *
 * Lives in the owning feature (`organizationService` is single-writer, see
 * `architecture/single-writer.test.ts`).
 *
 * The reason this is not simply "drop the join row": zero rows in
 * `organization_service_location` means "offered at EVERY branch"
 * (`shared/location-scope.ts`). Letting a Cork-only service fall to zero rows
 * would publish it — and its Cork price override — across the whole chain and
 * onto the public booking page. `isActive: false` is how a business withdraws
 * something, and it is reversible.
 */
export const withdrawServices = async (
  db: DbConnection,
  serviceIds: string[]
): Promise<void> => {
  if (serviceIds.length === 0) return;

  await db
    .update(organizationService)
    .set({ isActive: false })
    .where(inArray(organizationService.id, serviceIds));
};
