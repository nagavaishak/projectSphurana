import {
  asset,
  graphic,
  metaAd,
  metaAdService,
  metaCampaignConfig,
  organizationService,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { type CreateAdInput, createAdSchema } from './create-ad.schema.js';

/**
 * Internal implementation
 */
const createAdImpl = async (
  db: DbConnection,
  input: CreateAdInput
): Promise<Result<typeof metaAd.$inferSelect>> => {
  // Validate input
  const parsed = createAdSchema.safeParse(input);
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
    metaAdsPageId,
    replaceCampaignDrafts,
  } = parsed.data;

  // Creative is media-agnostic: callers pass a single creative id (a video,
  // an uploaded asset, OR a graphic), in either `videoId` or `graphicId`. We
  // auto-detect which kind it is and store it in the right column — the ad
  // wizard, for instance, puts a graphic id into the `videoId` field.
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

  // The assistant can legitimately retry or combine a service selection. Do
  // not rely on the junction table's unique/FK constraints to validate that
  // user-facing input: duplicates used to throw during its bulk insert and
  // become a 500 on POST /meta-ads (then a Sentry error in assistant chat).
  // Validate the complete set in the feature boundary, before any draft write.
  if (new Set(serviceIds).size !== serviceIds.length) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Service IDs must be unique'
      )
    );
  }

  const services = await db.query.organizationService.findMany({
    where: and(
      eq(organizationService.organizationId, organizationId),
      inArray(organizationService.id, serviceIds)
    ),
    columns: { id: true },
  });
  if (services.length !== serviceIds.length) {
    // Treat absent and cross-organization IDs identically. This both prevents
    // FK exceptions and avoids exposing whether another org owns an ID.
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'One or more services not found'
      )
    );
  }

  // Is it a graphic? (image creative)
  const graphicRecord = await db.query.graphic.findFirst({
    where: eq(graphic.id, creativeId),
    columns: { id: true, status: true, organizationId: true, outputs: true },
  });

  let resolvedVideoId: string | null = null;
  let resolvedGraphicId: string | null = null;

  if (graphicRecord) {
    if (graphicRecord.organizationId !== organizationId) {
      return err(
        new FeatureError(AdErrorCodes.VIDEO_NOT_FOUND, 'Graphic not found')
      );
    }
    // A still-rendering graphic is fine for a DRAFT — the chat card polls the
    // creative until it's ready, and launch (`resolveMediaAsset`) blocks
    // publishing until it's finished. Readiness is enforced at launch, not at
    // draft creation, so the campaign flow can attach the creative the moment
    // it kicks off the render instead of stalling for 1-3 minutes.
    resolvedGraphicId = creativeId;
  } else {
    // Verify video exists in either video table or asset table.
    const videoRecord = await db.query.video.findFirst({
      where: and(eq(video.id, creativeId), notDeleted(video)),
    });

    if (!videoRecord) {
      // Check asset table — an uploaded asset can be a video OR an image
      // (image assets become image creatives, the same as graphics). Don't
      // restrict to type='video', or uploaded images get rejected here while
      // launchAd's resolveMediaAsset accepts them.
      const assetRecord = await db.query.asset.findFirst({
        where: and(eq(asset.id, creativeId), notDeleted(asset)),
      });

      if (!assetRecord) {
        return err(
          new FeatureError(AdErrorCodes.VIDEO_NOT_FOUND, 'Media not found')
        );
      }
    }
    // A still-processing video is fine for a draft — readiness is enforced at
    // launch, not at draft creation (same rationale as the graphic above).
    resolvedVideoId = creativeId;
  }

  // Lead_form campaigns store their form at the campaign level; inherit it when
  // the ad didn't pick its own.
  const campaignConfig =
    followUpType !== 'chatbot'
      ? await db.query.metaCampaignConfig.findFirst({
          where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
          columns: { leadFormId: true },
        })
      : null;

  // Rebuild-replaces-drafts: when the assistant regenerates a campaign's ad
  // set after a pre-launch edit, clear the campaign's existing DRAFT ads first
  // so the new build replaces them instead of stacking. This is what stops an
  // edited 3-ad campaign from launching 6 ads and splitting its budget. Only
  // `draft` ads are removed — anything launching/live is left untouched, and
  // `meta_ad_service` junction rows cascade on the ad delete.
  if (replaceCampaignDrafts) {
    await db
      .delete(metaAd)
      .where(
        and(
          eq(metaAd.organizationId, organizationId),
          eq(metaAd.metaCampaignId, metaCampaignId),
          eq(metaAd.status, 'draft')
        )
      );
  }

  // Create ad in database
  const [result] = await db
    .insert(metaAd)
    .values({
      metaCampaignId,
      organizationId,
      videoId: resolvedVideoId,
      graphicId: resolvedGraphicId,
      name,
      headline,
      primaryText,
      description,
      callToAction,
      destinationUrl,
      targetingOverride: targeting,
      followUpType: followUpType || 'email_only',
      leadFormId:
        followUpType !== 'chatbot'
          ? leadFormId || campaignConfig?.leadFormId || null
          : null,
      sequenceId: followUpType === 'sequence' ? sequenceId || null : null,
      adPlacement: adPlacement || 'facebook',
      conversionDestination:
        followUpType === 'chatbot'
          ? conversionDestination || 'messenger'
          : null,
      metaAdsPageId: metaAdsPageId || null,
      status: 'draft',
    })
    .returning();

  // Insert ad-service junction rows
  if (serviceIds.length > 0) {
    await db
      .insert(metaAdService)
      .values(
        serviceIds.map((serviceId) => ({ metaAdId: result.id, serviceId }))
      );
  }

  return ok(result);
};

/**
 * Create a new Meta ad (draft only, not published)
 */
export const createAd = (db: DbConnection, input: CreateAdInput) =>
  trackedResult(
    'metaAds.createAd',
    () => withOrgScope((tx) => createAdImpl(tx, input), { db }),
    {
      properties: {
        metaCampaignId: input.metaCampaignId,
        videoId: input.videoId,
      },
    }
  );

/**
 * Result type for createAd
 */
export type CreateAdResult = Awaited<ReturnType<typeof createAd>>;
