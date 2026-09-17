import {
  metaAd,
  metaAdsIntegration,
  withDbRetry,
  withOrgScope,
} from '@borradh-workspace/database';
import { extractMetaErrorContext } from '@borradh-workspace/integrations';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import {
  type MetaAdsCredentials,
  MetaAdsService,
} from '@borradh-workspace/integrations/meta-ads';
import { metaCallToActionValues } from '@borradh-workspace/labels';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { CampaignErrorCodes } from '../../../meta-campaigns/models/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { handleMetaError } from '../_shared/handle-meta-error.js';
import { mapMetaAdStatus } from '../_shared/map-meta-ad-status.js';
import {
  type ImportMetaAdsInput,
  importMetaAdsSchema,
} from './import-meta-ads.schema.js';

const logger = createLogger('ImportMetaAds');

/**
 * Map Meta CTA type to local callToAction enum value.
 * Returns undefined if the CTA type is not in our enum.
 */
const mapCallToAction = (
  ctaType: string | undefined
): (typeof metaCallToActionValues)[number] | undefined => {
  if (!ctaType) return undefined;
  const validValues = new Set<string>(metaCallToActionValues);
  return validValues.has(ctaType)
    ? (ctaType as (typeof metaCallToActionValues)[number])
    : undefined;
};

export interface ImportMetaAdsData {
  imported: number;
  updated: number;
  total: number;
}

/**
 * Internal implementation
 */
const importMetaAdsImpl = async (
  db: DbConnection,
  input: ImportMetaAdsInput
): Promise<Result<ImportMetaAdsData>> => {
  // Validate input
  const parsed = importMetaAdsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Get Meta integration credentials (same pattern as sync-all-ads)
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: and(
      eq(metaAdsIntegration.organizationId, organizationId),
      eq(metaAdsIntegration.configurationStatus, 'configured'),
      eq(metaAdsIntegration.isActive, true)
    ),
    with: {
      defaultPage: true,
    },
  });

  if (!integration || !integration.encryptedCredentials) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'Meta Ads integration not configured. Please connect your Meta Ad Account first.'
      )
    );
  }

  if (!integration.adAccountId) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'No Ad Account selected. Please complete the Meta Ads integration setup.'
      )
    );
  }

  if (!integration.defaultPage || !integration.defaultPage.pageId) {
    return err(
      new FeatureError(
        CampaignErrorCodes.META_NOT_CONFIGURED,
        'No Facebook Page selected. Please complete the Meta Ads integration setup.'
      )
    );
  }

  // Decrypt credentials
  let credentials: MetaAdsCredentials;
  try {
    const decrypted = decryptCredentials<{ accessToken: string }>(
      integration.encryptedCredentials
    );
    credentials = {
      accessToken: decrypted.accessToken,
      adAccountId: integration.adAccountId,
      pageId: integration.defaultPage.pageId,
      pageName: integration.defaultPage.pageName ?? undefined,
    };
  } catch (error) {
    logError('metaAds.importMetaAds', error, {
      feature: 'meta-ads',
      extra: { organizationId, ...extractMetaErrorContext(error) },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to decrypt Meta credentials. Please reconnect your Meta account.'
      )
    );
  }

  // Initialize Meta service
  const metaService = new MetaAdsService(credentials);

  try {
    // Fetch all ads with creative data from Meta
    const metaAds = await metaService.listAllAdsWithCreative(100);

    // Get all local ads with metaAdId to build dedup set
    const localAds = await db.query.metaAd.findMany({
      where: and(
        eq(metaAd.organizationId, organizationId),
        isNotNull(metaAd.metaAdId)
      ),
      columns: {
        id: true,
        metaAdId: true,
        // The write below needs to know WHOSE copy this is, and what we
        // already hold, before it overwrites either.
        isImported: true,
        headline: true,
        primaryText: true,
        description: true,
        destinationUrl: true,
      },
    });

    const existingAdsByMetaId = new Map(
      localAds.map((ad) => [ad.metaAdId, ad])
    );

    // Also get ads being finalized (metaAdId not yet set) to prevent
    // duplicates when finalizeAd is still running in the background.
    // Match by metaVideoId (video ads) or metaAdSetId+name (image ads).
    const pendingStatuses = ['launching', 'active'] as const;
    const pendingAds = await db.query.metaAd.findMany({
      where: and(
        eq(metaAd.organizationId, organizationId),
        isNull(metaAd.metaAdId),
        inArray(metaAd.status, [...pendingStatuses])
      ),
      columns: { id: true, metaVideoId: true, metaAdSetId: true, name: true },
    });

    const pendingByVideoId = new Map(
      pendingAds
        .filter((ad) => ad.metaVideoId)
        .map((ad) => [ad.metaVideoId, ad.id])
    );

    const pendingByAdSetAndName = new Map(
      pendingAds
        .filter((ad) => ad.metaAdSetId && ad.name)
        .map((ad) => [`${ad.metaAdSetId}:${ad.name}`, ad.id])
    );

    let imported = 0;
    let updated = 0;

    for (const ad of metaAds) {
      const status = mapMetaAdStatus(ad.effectiveStatus);
      const cta = mapCallToAction(ad.creative?.callToActionType);
      const localAd = existingAdsByMetaId.get(ad.id);
      const localAdId = localAd?.id;
      const pendingAdId = !localAdId
        ? ((ad.creative?.videoId
            ? pendingByVideoId.get(ad.creative.videoId)
            : undefined) ??
          (ad.adsetId && ad.name
            ? pendingByAdSetAndName.get(`${ad.adsetId}:${ad.name}`)
            : undefined))
        : undefined;

      if (localAd && localAdId) {
        // COPY IS NOT UNCONDITIONALLY META'S TO OVERWRITE.
        //
        // This set used to read `headline: ad.creative?.title ?? null` and
        // friends, which had two ways to destroy the owner's words:
        //
        //  1. Graph only fills the top-level `creative.title` / `body` for
        //     creatives created WITH them. Everything Borradh builds goes
        //     through `object_story_spec`, so those came back empty and the
        //     `?? null` wrote the blank over the copy the owner had typed.
        //     (`readCreativeCopy` in the integrations client now looks in the
        //     story spec too, so this read is no longer blind — but a read
        //     that CAN come back empty must not be allowed to erase.)
        //  2. An ad WE authored is not Meta's to re-describe at all. Its copy
        //     is edited in Borradh; Meta holds a rendering of it.
        //
        // Verified on a preview before the fix: one `POST /meta-ads/import`
        // blanked headline, primaryText, description and destinationUrl on a
        // live, locally-created ad — and the next copy edit would then have
        // rebuilt the creative from those blanks and pushed EMPTY copy to the
        // running ad.
        //
        // So: only an IMPORTED ad takes its copy from Meta, and even then only
        // when Meta actually returned some. Everything else here (status,
        // ids, thumbnail) is genuinely Meta's and still syncs for every ad.
        const copyFromMeta = localAd.isImported
          ? {
              ...(ad.creative?.title ? { headline: ad.creative.title } : {}),
              ...(ad.creative?.body ? { primaryText: ad.creative.body } : {}),
              ...(ad.creative?.linkDescription
                ? { description: ad.creative.linkDescription }
                : {}),
              ...(ad.creative?.linkUrl
                ? { destinationUrl: ad.creative.linkUrl }
                : {}),
              ...(cta ? { callToAction: cta } : {}),
            }
          : {};

        // Update existing ad with latest data from Meta
        await db
          .update(metaAd)
          .set({
            // The NAME is Meta's for an imported ad and ours for one we made:
            // renaming in Ads Manager should show up here, but a sync must not
            // rename an ad the owner named in Borradh.
            ...(localAd.isImported ? { name: ad.name } : {}),
            ...copyFromMeta,
            status,
            metaStatus: ad.effectiveStatus,
            metaCampaignId: ad.campaignId ?? null,
            metaAdSetId: ad.adsetId ?? null,
            metaCreativeId: ad.creative?.id ?? null,
            metaVideoId: ad.creative?.videoId ?? null,
            ...(ad.creative?.thumbnailUrl
              ? { metaThumbnailUrl: ad.creative.thumbnailUrl }
              : {}),
            lastSyncAt: new Date(),
            syncError: null,
            updatedAt: new Date(),
          })
          .where(eq(metaAd.id, localAdId));

        updated++;
      } else if (pendingAdId) {
        // Ad is still being finalized — just link metaAdId so the next
        // sync picks it up via the normal dedup path. Don't overwrite
        // other fields since finalizeAd is still running.
        await db
          .update(metaAd)
          .set({
            metaAdId: ad.id,
            lastSyncAt: new Date(),
          })
          .where(eq(metaAd.id, pendingAdId));

        updated++;
      } else {
        // Insert new ad
        await db.insert(metaAd).values({
          organizationId,
          videoId: null,
          name: ad.name,
          headline: ad.creative?.title ?? null,
          primaryText: ad.creative?.body ?? null,
          description: ad.creative?.linkDescription ?? null,
          callToAction: cta ?? 'LEARN_MORE',
          destinationUrl: ad.creative?.linkUrl ?? null,
          status,
          isImported: true,
          metaAdId: ad.id,
          metaCampaignId: ad.campaignId ?? null,
          metaAdSetId: ad.adsetId ?? null,
          metaCreativeId: ad.creative?.id ?? null,
          metaVideoId: ad.creative?.videoId ?? null,
          metaStatus: ad.effectiveStatus,
          metaThumbnailUrl: ad.creative?.thumbnailUrl ?? null,
          lastSyncAt: new Date(),
        });

        imported++;
        logger.info(`Imported ad "${ad.name}" (${ad.id})`, {
          metaAdId: ad.id,
          campaignId: ad.campaignId,
        });
      }
    }

    return ok({
      imported,
      updated,
      total: metaAds.length,
    });
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaAds.importMetaAds',
      defaultErrorCode: ErrorCodes.INTERNAL_ERROR,
      defaultUserTitle: 'Failed to Import Ads',
      extra: { organizationId },
      db,
      organizationId,
    });
  }
};

/**
 * Import existing ads from Meta into the local database.
 *
 * Fetches all ads from the connected Meta Ad Account with their creative data
 * and creates local records for any ads not already tracked. Imported ads have
 * `videoId: null` and `isImported: true`.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Import input with organizationId
 * @returns Result with import statistics or error
 */
export const importMetaAds = (db: DbConnection, input: ImportMetaAdsInput) =>
  trackedResult(
    'metaAds.importMetaAds',
    // importMetaAdsImpl fetches from Meta AND writes inside one withOrgScope
    // transaction, so a Fly NAT severing the idle pooled connection mid-op used
    // to surface as a prod 500. withDbRetry replays the whole scoped import
    // (idempotent — dedup by metaAdId) on a fresh connection. (The deeper
    // anti-pattern — holding a txn across the Meta HTTP call — is tracked
    // separately; this stops the user-facing 500.)
    () =>
      withDbRetry(() =>
        withOrgScope((tx) => importMetaAdsImpl(tx, input), { db })
      ),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for importMetaAds
 */
export type ImportMetaAdsResult = Awaited<ReturnType<typeof importMetaAds>>;
