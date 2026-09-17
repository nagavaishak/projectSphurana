import { metaAdService } from '@borradh-workspace/database';
import type { DbConnection } from '../../../shared/index.js';

export async function linkServicesToAd(
  db: DbConnection,
  metaAdId: string,
  serviceIds: string[]
): Promise<void> {
  if (serviceIds.length === 0) return;

  await db
    .insert(metaAdService)
    .values(serviceIds.map((serviceId) => ({ metaAdId, serviceId })));
}
