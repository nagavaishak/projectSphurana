import { metaAd, socialPost, withOrgScope } from '@borradh-workspace/database';
import { extractMetaErrorContext } from '@borradh-workspace/integrations';
import {
  MetaAdsService,
  type MetaAssetFeedSpec,
  type MetaDegreesOfFreedomSpec,
} from '@borradh-workspace/integrations/meta-ads';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
  activateAdOnMeta,
  enableChatbotForPage,
  getMetaCredentials,
  handleMetaError,
  linkServicesToAd,
  resolveAdSet,
  setAdError,
  validateInstagramProfile,
  validatePaymentMethod,
} from '../_shared/index.js';
import { localStatusForLaunchState } from '../verify-ad-launch-state/index.js';
import {
  type LaunchAdFromPostInput,
  launchAdFromPostSchema,
} from './launch-ad-from-post.schema.js';

const logger = createLogger('MetaAds');

export interface LaunchAdFromPostResponse {
  ad: typeof metaAd.$inferSelect;
  metaCampaignId: string;
  metaAdSetId: string;
}

/**
 * Internal implementation
 */
const launchAdFromPostImpl = async (
  db: DbConnection,
  input: LaunchAdFromPostInput
): Promise<Result<LaunchAdFromPostResponse>> => {
  const parsed = launchAdFromPostSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    metaCampaignId,
    socialPostId,
    organizationId,
    name,
    targeting,
    followUpType,
    leadFormId,
    sequenceId,
    serviceIds,
    adPlacement,
    conversionDestination,
    metaAdsPageId,
  } = parsed.data;

  // ─── Verify social post exists and is published ───
  const post = await db.query.socialPost.findFirst({
    where: and(
      eq(socialPost.id, socialPostId),
      eq(socialPost.organizationId, organizationId)
    ),
  });

  if (!post) {
    return err(
      new FeatureError(
        AdErrorCodes.SOCIAL_POST_NOT_ELIGIBLE,
        'Social post not found'
      )
    );
  }

  if (post.status !== 'published' && post.status !== 'partial') {
    return err(
      new FeatureError(
        AdErrorCodes.SOCIAL_POST_NOT_ELIGIBLE,
        'Only published posts can be used as ads. Please publish the post first.'
      )
    );
  }

  // Find the platform result with a Meta post ID
  const platformResults = post.platformResults ?? [];
  const fbResult = platformResults.find(
    (r) => r.platform === 'facebook' && r.success && r.postId
  );
  const igResult = platformResults.find(
    (r) => r.platform === 'instagram' && r.success && r.postId
  );
  const bestResult = fbResult || igResult;

  if (!bestResult?.postId) {
    return err(
      new FeatureError(
        AdErrorCodes.SOCIAL_POST_NOT_ELIGIBLE,
        'This post does not have a Meta post ID. It may not have been published to Facebook or Instagram.'
      )
    );
  }

  const effectiveObjectStoryId = bestResult.postId;

  // ─── Get Meta integration credentials ───
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId,
    operationName: 'metaAds.launchAdFromPost',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage: selectedPage } = credResult.data;

  const metaService = new MetaAdsService(credentials);

  // Pre-flight checks: Instagram profile + payment method
  const igCheckResult = await validateInstagramProfile(
    metaService,
    selectedPage?.linkedInstagramAccountId,
    selectedPage?.linkedInstagramUsername
  );
  if (!igCheckResult.success) return igCheckResult;

  const paymentResult = await validatePaymentMethod(metaService);
  if (!paymentResult.success) return paymentResult;

  let metaAdSetId: string;

  try {
    // Step 1: Resolve ad set
    const adSetResult = await resolveAdSet(db, metaService, metaCampaignId);
    if (!adSetResult.success) return adSetResult;
    metaAdSetId = adSetResult.data;

    // Step 2: Create ad creative from existing post
    const creativeId = await metaService.createAdCreativeFromPost({
      name: `${name} - Creative`,
      effectiveObjectStoryId: effectiveObjectStoryId,
    });

    // Multi-destination messaging ads require degrees_of_freedom_spec + asset_feed_spec
    // Only use multi-destination for OUTCOME_ENGAGEMENT — OUTCOME_LEADS uses
    // MESSENGER-only destination and is incompatible with multi-destination.
    const isChatbot = followUpType === 'chatbot';
    let campaignObjective: string | undefined;
    if (isChatbot) {
      const campaign = await metaService.getCampaign(metaCampaignId);
      campaignObjective = campaign.objective;
    }
    const isMultiDestinationChatbot =
      isChatbot &&
      conversionDestination !== 'whatsapp' &&
      campaignObjective === 'OUTCOME_ENGAGEMENT';
    const pageId = metaService.getPageId();

    const degreesOfFreedomSpec: MetaDegreesOfFreedomSpec | undefined = isChatbot
      ? {
          creative_features_spec: {
            image_touchups: { enroll_status: 'OPT_OUT' },
            image_templates: { enroll_status: 'OPT_OUT' },
            inline_comment: { enroll_status: 'OPT_OUT' },
            text_optimizations: { enroll_status: 'OPT_OUT' },
            adapt_to_placement: { enroll_status: 'OPT_OUT' },
          },
        }
      : undefined;

    const assetFeedSpec: MetaAssetFeedSpec | undefined =
      isMultiDestinationChatbot
        ? {
            optimization_type: 'DOF_MESSAGING_DESTINATION',
            call_to_actions: [
              {
                type: 'MESSAGE_PAGE',
                value: {
                  app_destination: 'MESSENGER',
                  link: `https://www.facebook.com/${pageId}`,
                },
              },
              {
                type: 'INSTAGRAM_MESSAGE',
                value: {
                  app_destination: 'INSTAGRAM_DIRECT',
                  link: 'https://www.instagram.com',
                },
              },
            ],
          }
        : undefined;

    // Step 3: Create ad on Meta
    const metaAdId = await metaService.createAd({
      name,
      adSetId: metaAdSetId,
      creativeId,
      status: 'PAUSED',
      degreesOfFreedomSpec,
      assetFeedSpec,
    });

    // Step 4: Create local ad record BEFORE activating on Meta
    const [adRecord] = await db
      .insert(metaAd)
      .values({
        metaCampaignId,
        metaAdSetId,
        organizationId,
        socialPostId,
        useExistingPost: true,
        videoId: post.videoId,
        name,
        headline: post.title,
        primaryText: post.caption,
        targetingOverride: targeting,
        followUpType: followUpType || 'email_only',
        leadFormId: followUpType !== 'chatbot' ? leadFormId || null : null,
        sequenceId: followUpType === 'sequence' ? sequenceId || null : null,
        adPlacement: adPlacement || 'facebook',
        conversionDestination:
          followUpType === 'chatbot'
            ? conversionDestination || 'messenger'
            : null,
        metaAdsPageId: selectedPage.id,
        metaAdId,
        metaCreativeId: creativeId,
        metaStatus: 'PAUSED',
        // The ad is created PAUSED on Meta and has not been activated yet, so
        // it is 'launching' — NOT 'active' (ADR-005). The verified state is
        // written in step 5 from the Meta read-back.
        status: 'launching',
        lastSyncAt: new Date(),
      })
      .returning();

    // Row as it stands after activation + verification. Reassigned below so
    // the caller (and the HTTP response) reports the VERIFIED status, never
    // the pre-activation snapshot.
    let launchedAd = adRecord;

    // Step 5: Activate campaign, ad set, and ad on Meta
    try {
      const activationResult = await activateAdOnMeta(metaService, {
        metaCampaignId,
        metaAdSetId,
        metaAdId,
      });

      if (activationResult.success) {
        // Persist the READ-BACK state from Meta (ADR-005), not the 'ACTIVE'
        // we requested — the ad may be in review or inside a paused campaign.
        const { launch, permalink } = activationResult.data;
        const verified = {
          metaStatus: launch.adEffectiveStatus,
          status: localStatusForLaunchState(launch.state),
          metaPermalink: permalink,
          updatedAt: new Date(),
        };
        await db.update(metaAd).set(verified).where(eq(metaAd.id, adRecord.id));
        launchedAd = { ...adRecord, ...verified };
      } else {
        // Activation could not be verified. Do not leave the row claiming a
        // state we never confirmed — record 'pending', never 'active'.
        const unverified = {
          status: 'pending' as const,
          updatedAt: new Date(),
        };
        await db
          .update(metaAd)
          .set(unverified)
          .where(eq(metaAd.id, adRecord.id));
        launchedAd = { ...adRecord, ...unverified };
      }
    } catch (activationError) {
      logError('metaAds.launchAdFromPost.activate', activationError, {
        feature: 'meta-ads',
        extra: {
          adId: adRecord.id,
          metaCampaignId,
          metaAdSetId,
          metaAdId,
          ...extractMetaErrorContext(activationError),
        },
      });
      const syncError = `Failed to activate on Meta: ${activationError instanceof Error ? activationError.message : 'Unknown error'}`;
      await setAdError(db, adRecord.id, syncError);
      // Mirror what `setAdError` just wrote — the caller must not be handed a
      // row that still claims the ad is launching when activation failed.
      return ok({
        ad: { ...adRecord, status: 'error' as const, syncError },
        metaCampaignId,
        metaAdSetId,
      });
    }

    // Step 5a: Insert ad-service junction rows
    await linkServicesToAd(db, adRecord.id, serviceIds);

    // Step 5b: If chatbot follow-up, enable chatbot for this page
    if (followUpType === 'chatbot' && selectedPage) {
      await enableChatbotForPage(db, {
        metaAdsPageId: selectedPage.id,
      });
    }

    logger.info('Ad from post launch submitted', {
      adId: adRecord.id,
      metaAdId,
      socialPostId,
      status: launchedAd.status,
      metaStatus: launchedAd.metaStatus,
    });

    // Return the VERIFIED row (ADR-005) — the pre-activation snapshot would
    // report a status Meta never confirmed.
    return ok({ ad: launchedAd, metaCampaignId, metaAdSetId });
  } catch (error) {
    return await handleMetaError(error, {
      operationName: 'metaAds.launchAdFromPost',
      credentials,
      extra: { organizationId, socialPostId, metaCampaignId },
      defaultUserTitle: 'Failed to launch ad from post',
      db,
      organizationId,
    });
  }
};

/**
 * Launch a Meta ad from an existing published social post.
 * Uses the post's content as ad creative (boost post pattern).
 * No video upload needed — creative is created via object_story_id.
 */
export const launchAdFromPost = (
  db: DbConnection,
  input: LaunchAdFromPostInput
) =>
  trackedResult(
    'metaAds.launchAdFromPost',
    () => withOrgScope((tx) => launchAdFromPostImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        socialPostId: input.socialPostId,
      },
    }
  );

export type LaunchAdFromPostResult = Awaited<
  ReturnType<typeof launchAdFromPost>
>;
