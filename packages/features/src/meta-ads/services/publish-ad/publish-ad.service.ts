import {
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import { getMetaErrorMessage } from '@borradh-workspace/integrations';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
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
  buildAdCreative,
  getMetaCredentials,
  handleMetaError,
  resolveAdSet,
  resolveMediaAsset,
  setAdError,
  uploadMediaToMeta,
} from '../_shared/index.js';
import {
  type VerifyAdLaunchStateData,
  localStatusForLaunchState,
  verifyAdLaunchState,
} from '../verify-ad-launch-state/index.js';
import { type PublishAdInput, publishAdSchema } from './publish-ad.schema.js';

const publishLogger = createLogger('PublishAd');

/**
 * Internal implementation
 */
const publishAdImpl = async (
  db: DbConnection,
  input: PublishAdInput
): Promise<
  Result<{
    ad: typeof metaAd.$inferSelect;
    /** Read-back state from Meta (ADR-005) — the ONLY source for "is it live". */
    launch: VerifyAdLaunchStateData;
    /**
     * True when this call was a NO-OP because the ad was already launched
     * (Phase 4 #95): no second Meta ad was created, no additional spend — the
     * `launch` state is a fresh re-read of the existing live ad.
     */
    alreadyLive?: boolean;
  }>
> => {
  // Validate input
  const parsed = publishAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId } = parsed.data;

  // Get the ad with video relation
  const adRecord = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adId),
    with: {
      video: true,
    },
  });

  if (!adRecord) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Verify organization access directly on the ad
  if (adRecord.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Check ad status - must be draft OR a previously-FAILED launch attempt
  // that never reached Meta (ENG-852). `setAdError` is called from TWO
  // places: (1) here, on a launch attempt that fails before `metaAdId` is
  // set — genuinely never reached Meta, safe to retry from scratch; (2)
  // `update-ad.service.ts`, when a Meta-sync push fails for an ad that is
  // ALREADY live (`ad.metaAdId` set) — that ad exists on Meta and must NOT
  // go through `createAd()` again, or a retry here would create a SECOND
  // live ad while the original keeps running unpaused and unbudgeted. So the
  // error-retry allowance is gated on `!metaAdId`; an errored ad that DOES
  // have a `metaAdId` falls through to the idempotent "already live" branch
  // below instead, exactly like any other non-draft status.
  const isRetryableUnlaunchedError =
    adRecord.status === 'error' && !adRecord.metaAdId;
  if (adRecord.status !== 'draft' && !isRetryableUnlaunchedError) {
    // Idempotency (Phase 4 #95): a repeated "launch" on an ad that already
    // went live must be a NO-OP — never a second Meta ad on the same budget,
    // and never a bare error that pushes the model to "just try launching
    // again". Re-read the ad's real state from Meta (ADR-005) and report it as
    // already-live. Only ads that actually reached Meta qualify; anything else
    // keeps the original invalid-state error.
    if (adRecord.metaAdId && adRecord.metaCampaignId) {
      const reReadCampaignConfig = await db.query.metaCampaignConfig.findFirst({
        where: eq(metaCampaignConfig.metaCampaignId, adRecord.metaCampaignId),
      });
      const reReadCreds = await getMetaCredentials(db, {
        organizationId,
        metaAdsPageId: adRecord.metaAdsPageId ?? undefined,
        adAccountId: reReadCampaignConfig?.adAccountId ?? undefined,
        requireConfigured: false,
        operationName: 'metaAds.publishAd.alreadyLive',
      });
      if (reReadCreds.success) {
        const reReadService = new MetaAdsService(reReadCreds.data.credentials);
        const verifyResult = await verifyAdLaunchState(reReadService, {
          metaAdId: adRecord.metaAdId,
          metaCampaignId: adRecord.metaCampaignId,
        });
        const launch: VerifyAdLaunchStateData = verifyResult.success
          ? verifyResult.data
          : {
              state: 'unverified',
              adEffectiveStatus: null,
              campaignEffectiveStatus: null,
              detail:
                'This ad was already launched, but its current state could not be re-read from Meta.',
            };
        return ok({ ad: adRecord, launch, alreadyLive: true });
      }
    }

    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        `Cannot publish ad in ${adRecord.status} status. Only draft ads (or ads stuck in error after a failed launch) can be published.`
      )
    );
  }

  // Ad must have a Meta campaign ID
  if (!adRecord.metaCampaignId) {
    return err(
      new FeatureError(
        AdErrorCodes.CAMPAIGN_NOT_FOUND,
        'Ad has no campaign assigned. Please select a campaign first.'
      )
    );
  }

  // Resolve the creative — a video OR a graphic (image creative). Earlier this
  // only looked at `videoId`, so graphic ads (videoId null) were rejected here
  // with "No media attached" (→ 404), even though their image was ready.
  // `resolveMediaAsset` already handles the graphic table → assetType 'image'.
  const creativeMediaId = adRecord.videoId ?? adRecord.graphicId;
  if (!creativeMediaId) {
    return err(
      new FeatureError(
        AdErrorCodes.VIDEO_NOT_FOUND,
        'No media attached to this ad. Imported ads cannot be published from Borradh.'
      )
    );
  }

  const mediaResult = await resolveMediaAsset(
    db,
    creativeMediaId,
    adRecord.name
  );
  if (!mediaResult.success) return mediaResult;

  const { mediaBlobUrl, mediaTitle, assetType } = mediaResult.data;

  // Look up campaign config for ad account resolution
  const campaignConfig = adRecord.metaCampaignId
    ? await db.query.metaCampaignConfig.findFirst({
        where: eq(metaCampaignConfig.metaCampaignId, adRecord.metaCampaignId),
      })
    : null;

  // Get Meta integration credentials using ad's page + campaign's ad account
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: adRecord.metaAdsPageId ?? undefined,
    adAccountId: campaignConfig?.adAccountId ?? undefined,
    requireConfigured: false,
    operationName: 'metaAds.publishAd',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage } = credResult.data;

  const metaService = new MetaAdsService(credentials);
  const metaCampaignId = adRecord.metaCampaignId;

  // Resolve ad set ID (from ad record or via API)
  let metaAdSetId = adRecord.metaAdSetId;
  if (!metaAdSetId) {
    const adSetResult = await resolveAdSet(db, metaService, metaCampaignId);
    if (!adSetResult.success) return adSetResult;
    metaAdSetId = adSetResult.data;
  }

  try {
    // Update ad status to pending. `syncError` is cleared here so a retried
    // error-status ad (ENG-852) doesn't keep showing the PREVIOUS failure's
    // message while this attempt is in flight — the success path already
    // clears it, but a retry that fails again should report only the NEW
    // error, not a stale one left over from setAdError.
    await db
      .update(metaAd)
      .set({
        status: 'pending',
        metaAdSetId,
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, adId));

    // Upload media to Meta
    const uploadResult = await uploadMediaToMeta(metaService, {
      mediaBlobUrl,
      mediaTitle,
      assetType,
    });

    if (!uploadResult.success) {
      await setAdError(db, adId, uploadResult.error.message);

      return err(uploadResult.error);
    }

    const { metaVideoId, metaImageHash, thumbnailUrl } = uploadResult.data;
    const videoThumbnailUrl =
      thumbnailUrl ?? adRecord.video?.thumbnailUrl ?? undefined;

    if (assetType === 'image' && !metaImageHash) {
      await setAdError(
        db,
        adId,
        'Image upload to Meta did not return an image hash. Please try again.'
      );
      return err(
        new FeatureError(
          AdErrorCodes.VIDEO_NOT_READY,
          'Image upload to Meta failed.'
        )
      );
    }

    // Resolve the campaign objective + ad-set destination ONCE, up front, and
    // pass them into the builder. This is the source of truth for whether the
    // creative must be a messaging (click-to-message) creative — the ad row's
    // followUpType is unreliable (left as 'lead_form' on messaging campaigns).
    let campaignObjective: string | undefined;
    let adSetDestinationType: string | undefined;
    try {
      const [campaign, adSets] = await Promise.all([
        metaService.getCampaign(metaCampaignId).catch(() => null),
        metaService.listAdSets(metaCampaignId).catch(() => []),
      ]);
      campaignObjective = campaign?.objective;
      adSetDestinationType = adSets.find(
        (s) => s.id === metaAdSetId
      )?.destinationType;
    } catch {
      // Non-fatal — the builder falls back to the objective heuristic.
    }

    // Build the creative via the single shared builder — same path as
    // finalizeAd. The messaging-aware CTA (derived from the ad-set destination)
    // is what makes an image/offer creative compatible with a messaging
    // objective; the old code hardcoded a LEARN_MORE/BOOK_NOW traffic CTA,
    // which Meta rejected for image link_data (error 100/1487891).
    const creativeResult = await buildAdCreative(db, metaService, {
      adRecord,
      organizationId,
      resolvedPage,
      metaVideoId,
      metaImageHash,
      videoThumbnailUrl,
      campaignObjective,
      adSetDestinationType,
    });
    if (!creativeResult.success) {
      await setAdError(db, adId, creativeResult.error.message);
      return err(creativeResult.error);
    }
    const { creativeId, degreesOfFreedomSpec } = creativeResult.data;

    publishLogger.info('[publish-ad] pre-createAd context', {
      adId,
      assetType,
      hasImage: !!metaImageHash,
      hasVideo: !!metaVideoId,
      creativeId,
      campaignObjective,
      adSetId: metaAdSetId,
      adSetDestinationType,
      followUpType: adRecord.followUpType,
      conversionDestination: adRecord.conversionDestination,
      callToAction: adRecord.callToAction,
      adPlacement: adRecord.adPlacement,
      // With the fix, a messaging ad set yields a degrees-of-freedom spec, so
      // this is `true` once the new code is actually loaded.
      resolvedMessagingCreative: !!degreesOfFreedomSpec,
    });

    // Create ad on Meta
    const metaAdCreatedId = await metaService.createAd({
      name: adRecord.name,
      adSetId: metaAdSetId,
      creativeId,
      status: 'ACTIVE',
      degreesOfFreedomSpec,
    });

    // Activate campaign and ad set
    await metaService.updateCampaign(metaCampaignId, {
      status: 'ACTIVE',
    });
    await metaService.updateAdSet(metaAdSetId, {
      status: 'ACTIVE',
    });

    // Read back the ad's effective_status AND the parent campaign status from
    // Meta (ADR-005). The status we persist and report is what Meta says the
    // ad IS, never the 'ACTIVE' we asked for — the hardcoded literal here was
    // the false-success class (#105 #138 #201): PENDING_REVIEW /
    // CAMPAIGN_PAUSED / DISAPPROVED ads were all recorded and reported live.
    const verifyResult = await verifyAdLaunchState(metaService, {
      metaAdId: metaAdCreatedId,
      metaCampaignId,
    });
    const launch: VerifyAdLaunchStateData = verifyResult.success
      ? verifyResult.data
      : {
          state: 'unverified',
          adEffectiveStatus: null,
          campaignEffectiveStatus: null,
          detail:
            'The launch request was submitted, but the read-back from Meta failed — the ad must not be reported as live until verified.',
        };

    // Update local ad record (snapshot ad account) with the READ-BACK state.
    const [updatedAd] = await db
      .update(metaAd)
      .set({
        metaAdId: metaAdCreatedId,
        metaCreativeId: creativeId,
        ...(metaVideoId && { metaVideoId }),
        ...(metaImageHash && { metaImageHash }),
        adAccountId: credentials.adAccountId,
        metaStatus: launch.adEffectiveStatus,
        status: localStatusForLaunchState(launch.state),
        lastSyncAt: new Date(),
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, adId))
      .returning();

    return ok({ ad: updatedAd, launch });
  } catch (error) {
    // Revert ad status to draft on error
    const errorMessage = getMetaErrorMessage(error);
    await db
      .update(metaAd)
      .set({
        status: 'draft',
        syncError: errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, adId));

    return await handleMetaError(error, {
      operationName: 'metaAds.publishAd',
      extra: { organizationId, adId },
      defaultUserTitle: 'Failed to publish ad',
      db,
      organizationId,
    });
  }
};

/**
 * Publish an existing draft ad to Meta
 */
export const publishAd = (db: DbConnection, input: PublishAdInput) =>
  trackedResult(
    'metaAds.publishAd',
    () => withOrgScope((tx) => publishAdImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        adId: input.adId,
      },
    }
  );

/**
 * Result type for publishAd
 */
export type PublishAdResult = Awaited<ReturnType<typeof publishAd>>;
