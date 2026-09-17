import {
  metaAdsIntegration,
  withDbRetry,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { backfillCampaignConfigs } from '../../../meta-ads/services/ensure-campaign-config/index.js';
import { importMetaAds } from '../../../meta-ads/services/import-meta-ads/index.js';
import { syncAllAds } from '../../../meta-ads/services/sync-all-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type SyncMetaDataInput,
  syncMetaDataSchema,
} from './sync-meta-data.schema.js';

/**
 * Unified sync result - campaigns are no longer synced locally
 */
export interface UnifiedSyncResult {
  ads: { created: number; updated: number; deleted: number; imported: number };
  /** Local campaign-config rows backfilled for previously-ran (imported) campaigns. */
  campaignConfigsBackfilled: number;
  skipped: boolean;
  lastSyncAt: string | null;
}

/**
 * Check sync throttle (5 min cooldown)
 */
const SYNC_THROTTLE_MS = 5 * 60 * 1000;

/**
 * Internal implementation
 */
const syncMetaDataImpl = async (
  db: DbConnection,
  input: SyncMetaDataInput
): Promise<Result<UnifiedSyncResult>> => {
  // Validate input
  const parsed = syncMetaDataSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, force } = parsed.data;

  // Check throttle unless force sync
  if (!force) {
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: and(
        eq(metaAdsIntegration.organizationId, organizationId),
        eq(metaAdsIntegration.configurationStatus, 'configured'),
        eq(metaAdsIntegration.isActive, true)
      ),
      columns: { lastSyncAt: true, tokenStatus: true },
    });

    // Known-dead token: a background (non-force) sync against it is pure retry
    // noise — every Meta call would fail 190 until the user reconnects. Skip
    // quietly. A force (user-initiated) sync still attempts the real calls so
    // a stale flag can never block an explicit retry.
    if (integration?.tokenStatus === 'needs_reconnect') {
      return ok({
        ads: { created: 0, updated: 0, deleted: 0, imported: 0 },
        campaignConfigsBackfilled: 0,
        skipped: true,
        lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
      });
    }

    if (integration?.lastSyncAt) {
      const elapsed = Date.now() - integration.lastSyncAt.getTime();
      if (elapsed < SYNC_THROTTLE_MS) {
        return ok({
          ads: { created: 0, updated: 0, deleted: 0, imported: 0 },
          campaignConfigsBackfilled: 0,
          skipped: true,
          lastSyncAt: integration.lastSyncAt.toISOString(),
        });
      }
    }
  }

  // Sync all ads from Meta (campaigns are fetched live, no local sync needed)
  const adsResult = await syncAllAds(db, { organizationId });

  if (!adsResult.success) {
    return err(
      new FeatureError(
        adsResult.error.code,
        adsResult.error.message,
        adsResult.error.details
      )
    );
  }

  // Import any new ads from Meta that aren't tracked locally
  const importResult = await importMetaAds(db, { organizationId });
  const imported = importResult.success ? importResult.data.imported : 0;

  // Backfill local campaign-config rows for previously-ran (imported) campaigns
  // that were created directly on Meta. This is what makes those campaigns
  // launch-able and duplicable — they have no config row otherwise. Best-effort:
  // a backfill failure must not fail the whole sync.
  const backfillResult = await backfillCampaignConfigs(db, { organizationId });
  const campaignConfigsBackfilled = backfillResult.success
    ? backfillResult.data.created
    : 0;

  // Update lastSyncAt on integration. This runs after the slow Meta sync above,
  // so the pooled connection may have been severed by Fly's NAT while idle —
  // retry on a fresh connection rather than 500 the whole sync. Idempotent.
  await withDbRetry(
    () =>
      db
        .update(metaAdsIntegration)
        .set({ lastSyncAt: new Date() })
        .where(
          and(
            eq(metaAdsIntegration.organizationId, organizationId),
            eq(metaAdsIntegration.configurationStatus, 'configured'),
            eq(metaAdsIntegration.isActive, true)
          )
        ),
    { retries: 3, minDelayMs: 100, maxDelayMs: 1000 }
  );

  return ok({
    ads: {
      created: adsResult.data.created,
      updated: adsResult.data.updated,
      deleted: adsResult.data.deleted,
      imported,
    },
    campaignConfigsBackfilled,
    skipped: false,
    lastSyncAt: new Date().toISOString(),
  });
};

/**
 * Sync Meta ad data to local database
 *
 * Campaigns are no longer stored locally - they are fetched live from Meta API.
 * This service only syncs ad statuses from Meta.
 */
export const syncMetaData = (db: DbConnection, input: SyncMetaDataInput) =>
  trackedResult(
    'metaSync.syncMetaData',
    () => withOrgScope((tx) => syncMetaDataImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for syncMetaData
 */
export type SyncMetaDataResult = Awaited<ReturnType<typeof syncMetaData>>;
