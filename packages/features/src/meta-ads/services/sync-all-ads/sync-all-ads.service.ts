import { metaAd, withDbRetry } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNotNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import {
  getMetaCredentials,
  handleMetaError,
  mapMetaAdStatus,
} from '../_shared/index.js';
import {
  type SyncAllAdsInput,
  syncAllAdsSchema,
} from './sync-all-ads.schema.js';

const logger = createLogger('SyncAllAds');

interface SyncAllAdsData {
  created: number;
  updated: number;
  deleted: number;
}

/**
 * Internal implementation
 */
const syncAllAdsImpl = async (
  db: DbConnection,
  input: SyncAllAdsInput
): Promise<Result<SyncAllAdsData>> => {
  // Validate input
  const parsed = syncAllAdsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Get Meta integration credentials
  const credResult = await getMetaCredentials(db, {
    organizationId,
    operationName: 'metaAds.syncAllAds',
  });
  if (!credResult.success) return credResult;

  // Initialize Meta service
  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // Fetch ALL non-deleted ads from Meta (all statuses).
    // Meta does not return truly deleted ads, so any local ad
    // with a metaAdId that is NOT in this response has been deleted.
    const metaAds = await metaService.listAllAds(100);

    // Build a set of all Meta ad IDs for fast lookup
    const metaAdIdSet = new Set(metaAds.map((ad) => ad.id));

    // The DB work below runs AFTER the (slow) listAllAds call above, during
    // which the pooled connection sat idle and may have been silently severed
    // by Fly's NAT — the next statement then dies with postgres.js's
    // "Cannot read properties of null (reading 'write')". Wrap the DB block in
    // withDbRetry so that case reconnects and replays on a fresh connection
    // instead of failing the whole sync with a 500. Every statement is
    // idempotent (updates/deletes keyed by id), so a replay is safe. Tight
    // params: the reconnect is fast and this request is already latency-heavy.
    const { updated, deleted } = await withDbRetry(
      async () => {
        // Get ALL local ads for this org that have been published to Meta
        const allLocalAds = await db.query.metaAd.findMany({
          where: and(
            eq(metaAd.organizationId, organizationId),
            isNotNull(metaAd.metaAdId)
          ),
        });

        // Create a map of metaAdId to local ad
        const localAdMap = new Map(allLocalAds.map((ad) => [ad.metaAdId, ad]));

        let updatedCount = 0;
        let deletedCount = 0;

        // Update existing local ads with status from Meta
        for (const metaAdData of metaAds) {
          const localAd = localAdMap.get(metaAdData.id);

          if (localAd) {
            const newStatus = mapMetaAdStatus(metaAdData.effectiveStatus);

            await db
              .update(metaAd)
              .set({
                status: newStatus,
                metaStatus: metaAdData.effectiveStatus,
                // Always update thumbnail from Meta if available
                ...(metaAdData.thumbnailUrl
                  ? { metaThumbnailUrl: metaAdData.thumbnailUrl }
                  : {}),
                // Populate permalink if missing and now available from Meta
                ...(!localAd.metaPermalink && metaAdData.permalinkUrl
                  ? { metaPermalink: metaAdData.permalinkUrl }
                  : {}),
                lastSyncAt: new Date(),
                syncError: null,
                updatedAt: new Date(),
              })
              .where(eq(metaAd.id, localAd.id));

            updatedCount++;
          }
          // Note: We don't create new ads here because they require a videoId
          // which we can't get from Meta. Only ads created in our system are trackedResult.
        }

        // Delete local ads that no longer exist on Meta
        for (const localAd of allLocalAds) {
          if (localAd.metaAdId && !metaAdIdSet.has(localAd.metaAdId)) {
            await db.delete(metaAd).where(eq(metaAd.id, localAd.id));
            logger.info(`Deleted ad ${localAd.id} (no longer exists on Meta)`, {
              metaAdId: localAd.metaAdId,
            });
            deletedCount++;
          }
        }

        return { updated: updatedCount, deleted: deletedCount };
      },
      { retries: 3, minDelayMs: 100, maxDelayMs: 1000 }
    );

    return ok({
      created: 0, // We don't create ads from Meta - they require local video references
      updated,
      deleted,
    });
  } catch (error) {
    return await handleMetaError(error, {
      operationName: 'metaAds.syncAllAds',
      extra: { organizationId },
      defaultErrorCode: AdErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to sync ads from Meta',
      db,
      organizationId,
    });
  }
};

/**
 * Sync all ads from Meta to local database
 *
 * Fetches all active ads from the connected Meta Ad Account and
 * updates status of matching local ads.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Sync input with organizationId
 * @returns Result with sync statistics or error
 *
 * @example
 * ```ts
 * const result = await syncAllAds(db, { organizationId: 'org-123' });
 *
 * if (result.success) {
 *   console.log(`Synced ${result.data.updated} ads`);
 * }
 * ```
 */
export const syncAllAds = (db: DbConnection, input: SyncAllAdsInput) =>
  trackedResult('metaAds.syncAllAds', () => syncAllAdsImpl(db, input), {
    properties: { organizationId: input.organizationId },
    trackSuccess: false,
    trackFailure: false,
  });

/**
 * Result type for syncAllAds
 */
export type SyncAllAdsResult = Awaited<ReturnType<typeof syncAllAds>>;
