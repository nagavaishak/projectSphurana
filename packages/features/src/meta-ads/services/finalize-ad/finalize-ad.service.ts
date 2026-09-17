import { metaAd, metaCampaignConfig } from '@borradh-workspace/database';
import {
  getMetaErrorInfo,
  getMetaErrorMessage,
  isMetaAuthError,
} from '@borradh-workspace/integrations';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { handleMetaAuthError } from '../../../integrations/services/mark-needs-reconnect/mark-needs-reconnect.service.js';
import type { DbConnection } from '../../../shared/index.js';
import {
  activateAdOnMeta,
  buildAdCreative,
  getMetaCredentials,
  logMetaErrorIfUnknown,
  resolveMediaAsset,
  setAdError,
  uploadMediaToMeta,
} from '../_shared/index.js';
import { localStatusForLaunchState } from '../verify-ad-launch-state/index.js';

const logger = createLogger('FinalizeAd');

/**
 * Finalize a launched ad in the background.
 *
 * Called after the sync phase of launchAd returns. Polls Meta for
 * video readiness, creates ad creative + ad, activates campaign/ad set,
 * and updates the local DB record.
 *
 * This function never throws — errors are recorded on the ad record.
 */
export const finalizeAd = async (
  db: DbConnection,
  adId: string,
  organizationId: string
): Promise<void> => {
  try {
    // Fetch the ad record
    const adRecord = await db.query.metaAd.findFirst({
      where: eq(metaAd.id, adId),
    });

    if (!adRecord) {
      logger.error(`Cannot finalize ad ${adId}: record not found`);
      return;
    }

    if (!adRecord.metaCampaignId || !adRecord.metaAdSetId) {
      logger.error(
        `Cannot finalize ad ${adId}: missing metaCampaignId or metaAdSetId`
      );
      return;
    }

    // Look up campaign config for ad account resolution
    const campaignConfig = adRecord.metaCampaignId
      ? await db.query.metaCampaignConfig.findFirst({
          where: eq(metaCampaignConfig.metaCampaignId, adRecord.metaCampaignId),
        })
      : null;

    // Get Meta integration credentials
    const credResult = await getMetaCredentials(db, {
      organizationId,
      metaAdsPageId: adRecord.metaAdsPageId,
      adAccountId: campaignConfig?.adAccountId ?? undefined,
      operationName: 'metaAds.finalizeAd',
    });

    if (!credResult.success) {
      await setAdError(db, adId, credResult.error.message);
      return;
    }

    const { credentials, resolvedPage } = credResult.data;
    const metaService = new MetaAdsService(credentials);

    // Resolve and upload media
    let metaVideoId = adRecord.metaVideoId;
    let metaImageHash = adRecord.metaImageHash;
    let videoThumbnailUrl: string | undefined;

    const creativeMediaId = adRecord.videoId ?? adRecord.graphicId;
    if (!metaVideoId && !metaImageHash && creativeMediaId) {
      const mediaResult = await resolveMediaAsset(
        db,
        creativeMediaId,
        adRecord.name
      );
      if (!mediaResult.success) {
        await setAdError(db, adId, mediaResult.error.message);
        return;
      }

      const uploadResult = await uploadMediaToMeta(metaService, {
        mediaBlobUrl: mediaResult.data.mediaBlobUrl,
        mediaTitle: mediaResult.data.mediaTitle,
        assetType: mediaResult.data.assetType,
      });

      if (!uploadResult.success) {
        await setAdError(db, adId, uploadResult.error.message);
        return;
      }

      metaVideoId = uploadResult.data.metaVideoId ?? metaVideoId;
      metaImageHash = uploadResult.data.metaImageHash ?? metaImageHash;
      videoThumbnailUrl = uploadResult.data.thumbnailUrl;

      // Save upload IDs so we can resume if later steps fail
      await db
        .update(metaAd)
        .set({
          ...(metaVideoId && { metaVideoId }),
          ...(metaImageHash && { metaImageHash }),
          updatedAt: new Date(),
        })
        .where(eq(metaAd.id, adId));
    } else if (metaVideoId) {
      // Video was already uploaded — wait for encoding
      const videoStatus = await metaService.waitForVideoReady(
        metaVideoId,
        60,
        3000
      );
      if (!videoStatus.isReady) {
        await setAdError(
          db,
          adId,
          videoStatus.errorMessage ||
            'Video processing timed out on Meta. The video may be too large or in an unsupported format. Please try again or use a shorter video.'
        );
        return;
      }
      videoThumbnailUrl = videoStatus.thumbnailUrl;
    }

    // Build the creative via the single shared builder (image vs video,
    // messaging-aware CTA, IG actor, objective-gated multi-destination). The
    // same builder backs publishAd, so the two paths can't drift again.
    const creativeResult = await buildAdCreative(db, metaService, {
      adRecord,
      organizationId,
      resolvedPage,
      metaVideoId,
      metaImageHash,
      videoThumbnailUrl,
    });
    if (!creativeResult.success) {
      await setAdError(db, adId, creativeResult.error.message);
      return;
    }
    const { creativeId, degreesOfFreedomSpec } = creativeResult.data;

    logger.info('Creative created', {
      adId,
      creativeId,
      assetType: metaImageHash && !metaVideoId ? 'image' : 'video',
    });

    // ── DEBUG: Verify the creative exists on Meta before using it ──
    try {
      const creativeCheck = await metaService.getCreative(creativeId);
      logger.info('[DEBUG] Creative verification', {
        adId,
        creativeId,
        creativeExists: !!creativeCheck,
        creativeStatus: creativeCheck?.status,
        creativeObjectStorySpec: !!creativeCheck?.object_story_spec,
      });
    } catch (verifyError) {
      logger.warn('[DEBUG] Creative verification failed — proceeding anyway', {
        adId,
        creativeId,
        error:
          verifyError instanceof Error
            ? verifyError.message
            : String(verifyError),
      });
    }

    // ── DEBUG: Log exact createAd payload ──
    logger.info('[DEBUG] Creating ad — exact payload', {
      adId,
      payload: {
        name: adRecord.name,
        adset_id: adRecord.metaAdSetId,
        creative: { creative_id: creativeId },
        status: 'PAUSED',
      },
    });

    const metaAdId = await metaService.createAd({
      name: adRecord.name,
      adSetId: adRecord.metaAdSetId,
      creativeId,
      status: 'PAUSED',
      degreesOfFreedomSpec,
    });

    // Activate campaign, ad set, and ad
    const activationResult = await activateAdOnMeta(metaService, {
      metaCampaignId: adRecord.metaCampaignId,
      metaAdSetId: adRecord.metaAdSetId,
      metaAdId,
    });

    const metaPermalink = activationResult.success
      ? activationResult.data.permalink
      : null;

    // The read-back state from Meta (ADR-005). `activateAdOnMeta` verifies the
    // ad's effective_status + parent campaign status after activation; persist
    // THAT, never a hardcoded 'ACTIVE' — the ad may be in review, disapproved,
    // or sitting in a paused campaign.
    const launch = activationResult.success
      ? activationResult.data.launch
      : null;

    // Update local ad record with the verified state. When verification was
    // impossible, record 'pending' — never fabricate live.
    await db
      .update(metaAd)
      .set({
        metaAdId,
        metaCreativeId: creativeId,
        metaPermalink,
        metaThumbnailUrl: videoThumbnailUrl ?? undefined,
        metaStatus: launch?.adEffectiveStatus ?? null,
        status: launch
          ? localStatusForLaunchState(launch.state)
          : ('pending' as const),
        lastSyncAt: new Date(),
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, adId));

    logger.info(`Ad ${adId} finalized`, {
      metaAdId,
      launchState: launch?.state ?? 'unverified',
      adEffectiveStatus: launch?.adEffectiveStatus ?? null,
      campaignEffectiveStatus: launch?.campaignEffectiveStatus ?? null,
    });
  } catch (error) {
    // Mark integration as needs_reconnect if this is an auth error
    if (isMetaAuthError(error)) {
      await handleMetaAuthError(db, error, {
        type: 'meta_ads',
        organizationId,
      });
    }

    // Only log unknown/unclassified errors to Sentry
    logMetaErrorIfUnknown('metaAds.finalizeAd', error, {
      adId,
      organizationId,
    });

    // Use registry info for user-friendly error messages when available
    const metaErrorInfo = getMetaErrorInfo(error);
    const syncError =
      metaErrorInfo?.userMessage ??
      `Failed to finalize ad: ${getMetaErrorMessage(error)}`;

    try {
      await setAdError(db, adId, syncError);
    } catch {
      // DB error storing the sync error — non-critical
    }
  }
};
