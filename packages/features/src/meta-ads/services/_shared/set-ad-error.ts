import { metaAd } from '@borradh-workspace/database';
import { eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

export async function setAdError(
  db: DbConnection,
  adId: string,
  syncError: string
): Promise<void> {
  await db
    .update(metaAd)
    .set({
      status: 'error',
      syncError,
      updatedAt: new Date(),
    })
    .where(eq(metaAd.id, adId));
}
