import {
  graphic,
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import type { MessagingDestination } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { trackedResult } from '@borradh-workspace/observability';
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
  enableChatbotForPage,
  findOrCreateAdSet,
  getFreshDownloadUrl,
  getMetaCredentials,
  handleMetaError,
  linkServicesToAd,
  mapConversionDestination,
  resolveAdSet,
  resolveMediaAsset,
  validateInstagramProfile,
  validatePaymentMethod,
  validateWhatsAppDestinationPrerequisites,
} from '../_shared/index.js';
import { ensureCampaignConfig } from '../ensure-campaign-config/index.js';
import { type LaunchAdInput, launchAdSchema } from './launch-ad.schema.js';

export interface LaunchAdResponse {
  ad: typeof metaAd.$inferSelect;
  metaCampaignId: string;
  metaAdSetId: string;
}

/**
 * Internal implementation
 */
const launchAdImpl = async (
  db: DbConnection,
  input: LaunchAdInput
): Promise<Result<LaunchAdResponse>> => {
  // Validate input
  const parsed = launchAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    metaCampaignId,
    videoId,
    graphicId,
    organizationId,
    name,
    headline,
    primaryText,
    description,
    callToAction,
    destinationUrl,
    targeting,
    followUpType,
    leadFormId,
    sequenceId,
    serviceIds,
    adPlacement,
    conversionDestination,
    destinations,
    metaAdsPageId,
  } = parsed.data;

  // Look up campaign config for ad account resolution
  let campaignConfig = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
  });

  // Previously-ran campaigns (created directly on Meta / imported) have no
  // config row, which historically blocked launching ads into them
  // ("This campaign was not created in Borradh"). Backfill it on demand from
  // the campaign's existing ad set, then re-read so the rest of the flow has
  // the targeting + ad set it needs. Best-effort: if Meta is unreachable the
  // downstream resolvers still surface the original error.
  if (!campaignConfig) {
    const ensured = await ensureCampaignConfig(db, {
      organizationId,
      metaCampaignId,
      metaAdsPageId: metaAdsPageId ?? undefined,
    });
    if (ensured.success && ensured.data.created) {
      campaignConfig = await db.query.metaCampaignConfig.findFirst({
        where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
      });
    }
  }

  // Derive effective destinations for chatbot ads. Priority:
  // 1. Explicit destinations from the ad form (legacy path)
  // 2. Campaign config's destinationType (new path — destinations set at campaign creation)
  // 3. Legacy conversionDestination fallback
  let effectiveDestinations: MessagingDestination[] | undefined = destinations
    ? [...destinations]
    : undefined;

  if (!effectiveDestinations && followUpType === 'chatbot') {
    const destType = campaignConfig?.destinationType;
    if (destType) {
      const mapping: Record<string, MessagingDestination[]> = {
        WHATSAPP: ['whatsapp'],
        MESSENGER: ['messenger'],
        INSTAGRAM_DIRECT: ['instagram_dm'],
        MESSAGING_MESSENGER_WHATSAPP: ['messenger', 'whatsapp'],
        MESSAGING_INSTAGRAM_DIRECT_MESSENGER: ['instagram_dm', 'messenger'],
        MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: [
          'instagram_dm',
          'messenger',
          'whatsapp',
        ],
      };
      effectiveDestinations = mapping[destType];
    } else if (conversionDestination === 'whatsapp') {
      effectiveDestinations = ['whatsapp'];
    } else if (conversionDestination === 'messenger') {
      effectiveDestinations = ['messenger'];
    }
  }

  // Get Meta integration credentials
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    adAccountId: campaignConfig?.adAccountId ?? undefined,
    operationName: 'metaAds.launchAd',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage: selectedPage } = credResult.data;

  // Creative is media-agnostic: callers pass a single creative id (video,
  // asset, OR graphic) in either field. Auto-detect which kind it is so it
  // lands in the right column (the ad wizard puts a graphic id in `videoId`).
  const creativeIds = [videoId, graphicId].filter(Boolean) as string[];
  if (creativeIds.length !== 1) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Provide exactly one creative: a videoId or a graphicId'
      )
    );
  }
  const creativeId = creativeIds[0];
  const isGraphicCreative = Boolean(
    await db.query.graphic.findFirst({
      where: eq(graphic.id, creativeId),
      columns: { id: true },
    })
  );

  // Verify media exists and is ready — checks video, then asset, then graphic.
  const mediaResult = await resolveMediaAsset(db, creativeId, name);
  if (!mediaResult.success) return mediaResult;

  const { assetType } = mediaResult.data;
  const mediaBlobUrl = await getFreshDownloadUrl(mediaResult.data.mediaBlobUrl);
  const mediaTitle = mediaResult.data.mediaTitle;

  // Determine destination type
  const destinationType = mapConversionDestination(
    followUpType || 'email_only',
    conversionDestination
  );

  const metaService = new MetaAdsService(credentials);

  // Pre-flight checks: Instagram profile + payment method
  const igResult = await validateInstagramProfile(
    metaService,
    selectedPage?.linkedInstagramAccountId,
    selectedPage?.linkedInstagramUsername
  );
  if (!igResult.success) return igResult;

  const paymentResult = await validatePaymentMethod(metaService);
  if (!paymentResult.success) return paymentResult;

  // For chatbot ads that include WhatsApp, verify the org has an active
  // WABA and the selected page is linked to it before we hit the ad set
  // find-or-create path. Surfaces a clear disconnected/not-linked error
  // instead of a generic Meta rejection.
  if (followUpType === 'chatbot' && effectiveDestinations) {
    const whatsappPrereqResult = await validateWhatsAppDestinationPrerequisites(
      db,
      organizationId,
      selectedPage.pageId,
      effectiveDestinations
    );
    if (!whatsappPrereqResult.success) return whatsappPrereqResult;
  }

  let metaAdSetId: string;

  try {
    // Step 1: Resolve ad set
    const campaign = await metaService.getCampaign(metaCampaignId);

    // For messaging destinations (chatbot), validate campaign objective
    // Both OUTCOME_LEADS (lead generation) and OUTCOME_ENGAGEMENT (conversations) are valid
    const isMessagingDestination =
      destinationType === 'MESSAGING_INSTAGRAM_DIRECT_MESSENGER' ||
      destinationType === 'MESSENGER' ||
      destinationType === 'WHATSAPP';
    const validMessagingObjectives = ['OUTCOME_LEADS', 'OUTCOME_ENGAGEMENT'];

    if (
      isMessagingDestination &&
      !validMessagingObjectives.includes(campaign.objective)
    ) {
      return err(
        new FeatureError(
          AdErrorCodes.META_AD_CREATE_FAILED,
          `Messenger/WhatsApp ads require a Leads or Engagement campaign objective. This campaign uses "${campaign.objective}". Please create a new campaign with the correct objective.`
        )
      );
    }

    // For legacy chatbot campaigns without destinationType, infer
    // destinations from existing ad sets so new ads match.
    if (followUpType === 'chatbot' && !effectiveDestinations) {
      const existingAdSets = await metaService.listAdSets(metaCampaignId);
      const activeAdSet = existingAdSets.find((as) => {
        const status = as.effectiveStatus ?? as.status;
        return (
          status !== 'ARCHIVED' && status !== 'DELETED' && as.destinationType
        );
      });
      if (activeAdSet?.destinationType) {
        const mapping: Record<string, MessagingDestination[]> = {
          WHATSAPP: ['whatsapp'],
          MESSENGER: ['messenger'],
          INSTAGRAM_DIRECT: ['instagram_dm'],
          MESSAGING_MESSENGER_WHATSAPP: ['messenger', 'whatsapp'],
          MESSAGING_INSTAGRAM_DIRECT_MESSENGER: ['instagram_dm', 'messenger'],
          MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP: [
            'instagram_dm',
            'messenger',
            'whatsapp',
          ],
        };
        effectiveDestinations = mapping[activeAdSet.destinationType];
      }
    }

    // For chatbot ads with explicit destinations, find-or-create an ad
    // set that matches the requested destination_type. Meta anchors
    // destination_type on the ad set, so one campaign can contain
    // multiple destination-specific ad sets that ads attach to at launch.
    // Non-chatbot ads and legacy callers fall through to `resolveAdSet`.
    if (followUpType === 'chatbot' && effectiveDestinations) {
      // Infer optimization goal from the campaign config's stored
      // destinationType. WhatsApp always uses LINK_CLICKS because Meta
      // blocks CONVERSATIONS for WhatsApp on EU-based ad accounts.
      let optimizationGoalOverride = parsed.data.optimizationGoal;
      if (!optimizationGoalOverride && campaignConfig?.destinationType) {
        const hasWhatsApp = campaignConfig.destinationType.includes('WHATSAPP');
        if (hasWhatsApp) {
          optimizationGoalOverride = 'LINK_CLICKS';
        }
      }
      const findOrCreateResult = await findOrCreateAdSet({
        db,
        metaService,
        metaCampaignId,
        organizationId,
        destinations: effectiveDestinations,
        campaignObjective: campaign.objective,
        pageId: selectedPage.pageId,
        adSetNameHint: campaign.name || name,
        optimizationGoalOverride,
      });
      if (!findOrCreateResult.success) return findOrCreateResult;
      metaAdSetId = findOrCreateResult.data.metaAdSetId;
    } else {
      const adSetResult = await resolveAdSet(db, metaService, metaCampaignId);
      if (!adSetResult.success) return adSetResult;
      metaAdSetId = adSetResult.data;
    }

    // Step 2: Create ad in database (snapshot ad account)
    const [adRecord] = await db
      .insert(metaAd)
      .values({
        metaCampaignId,
        metaAdSetId,
        organizationId,
        videoId: isGraphicCreative ? null : creativeId,
        graphicId: isGraphicCreative ? creativeId : null,
        name,
        headline,
        primaryText,
        description,
        callToAction,
        destinationUrl,
        targetingOverride: targeting,
        followUpType: followUpType || 'email_only',
        // Inherit the campaign's lead form when the ad didn't pick its own —
        // lead_form campaigns store the form at the campaign level.
        leadFormId:
          followUpType !== 'chatbot'
            ? leadFormId || campaignConfig?.leadFormId || null
            : null,
        sequenceId: followUpType === 'sequence' ? sequenceId || null : null,
        adPlacement: adPlacement || 'facebook',
        conversionDestination:
          followUpType === 'chatbot'
            ? effectiveDestinations?.includes('whatsapp')
              ? 'whatsapp'
              : conversionDestination || 'messenger'
            : null,
        destinations:
          followUpType === 'chatbot' && effectiveDestinations
            ? effectiveDestinations
            : null,
        metaAdsPageId: selectedPage.id,
        adAccountId: credentials.adAccountId,
        status: 'launching',
      })
      .returning();

    // Step 2a: Insert ad-service junction rows
    await linkServicesToAd(db, adRecord.id, serviceIds);

    // Step 2b: If chatbot follow-up, enable chatbot for this page
    if (followUpType === 'chatbot' && selectedPage) {
      await enableChatbotForPage(db, {
        metaAdsPageId: selectedPage.id,
      });
    }

    // Step 3: Upload media to Meta
    if (assetType === 'image') {
      const imageUpload = await metaService.uploadImage(mediaBlobUrl);

      const [updatedAd] = await db
        .update(metaAd)
        .set({
          metaImageHash: imageUpload.imageHash,
          updatedAt: new Date(),
        })
        .where(eq(metaAd.id, adRecord.id))
        .returning();

      return ok({ ad: updatedAd, metaCampaignId, metaAdSetId });
    }

    // Video path: upload video, save metaVideoId for background finalizer
    const videoUpload = await metaService.uploadVideo(mediaBlobUrl, mediaTitle);

    const [updatedAd] = await db
      .update(metaAd)
      .set({
        metaVideoId: videoUpload.videoId,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, adRecord.id))
      .returning();

    // Return immediately — steps 4-8 run in background via finalizeAd
    return ok({ ad: updatedAd, metaCampaignId, metaAdSetId });
  } catch (error) {
    return await handleMetaError(error, {
      operationName: 'metaAds.launchAd',
      credentials,
      extra: { organizationId, videoId, metaCampaignId },
      defaultUserTitle: 'Failed to launch ad',
      db,
      organizationId,
    });
  }
};

/**
 * Launch a Meta ad (create locally and immediately publish to Meta)
 */
export const launchAd = (db: DbConnection, input: LaunchAdInput) =>
  trackedResult(
    'metaAds.launchAd',
    () => withOrgScope((tx) => launchAdImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        videoId: input.videoId,
      },
    }
  );

/**
 * Result type for launchAd
 */
export type LaunchAdResult = Awaited<ReturnType<typeof launchAd>>;
