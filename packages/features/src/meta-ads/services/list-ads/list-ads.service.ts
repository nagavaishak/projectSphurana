import {
  graphic,
  metaAd,
  metaAdService,
  organizationService,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { metaCallToActionValues } from '@borradh-workspace/labels';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  getMetaCredentials,
  loadAdPreviewMediaByMediaId,
  mapMetaAdStatus,
} from '../_shared/index.js';
import { type ListAdsInput, listAdsSchema } from './list-ads.schema.js';

const logger = createLogger('ListAds');

/**
 * Map Meta CTA type to local callToAction enum value.
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

/**
 * Auto-sync ads from Meta for a specific campaign.
 * Imports new ads not yet tracked locally and updates status of existing imported ads.
 * Fails silently if Meta integration is not configured.
 */
const syncCampaignAdsFromMeta = async (
  db: DbConnection,
  organizationId: string,
  metaCampaignId: string
): Promise<void> => {
  // Get Meta credentials — silently skip if not configured
  const credResult = await getMetaCredentials(db, { organizationId });
  if (!credResult.success) return;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    // Fetch ads from Meta for this specific campaign
    const metaAds = await metaService.listCampaignAdsWithCreative(
      metaCampaignId,
      100
    );

    if (metaAds.length === 0) return;

    // Get all local ads with a metaAdId for this org to build dedup set
    const localAds = await db.query.metaAd.findMany({
      where: and(
        eq(metaAd.organizationId, organizationId),
        isNotNull(metaAd.metaAdId)
      ),
      columns: { metaAdId: true, isImported: true },
    });

    const existingMetaAdIds = new Map(
      localAds.map((ad) => [ad.metaAdId, ad.isImported])
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
      columns: {
        id: true,
        metaVideoId: true,
        metaAdSetId: true,
        name: true,
      },
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
      const existingIsImported = existingMetaAdIds.get(ad.id);

      // Check if this Meta ad matches a pending ad still being finalized
      const pendingAdId =
        existingIsImported === undefined
          ? ((ad.creative?.videoId
              ? pendingByVideoId.get(ad.creative.videoId)
              : undefined) ??
            (ad.adsetId && ad.name
              ? pendingByAdSetAndName.get(`${ad.adsetId}:${ad.name}`)
              : undefined))
          : undefined;

      if (pendingAdId) {
        // Ad is still being finalized — link metaAdId so the next
        // sync picks it up via the normal dedup path.
        await db
          .update(metaAd)
          .set({
            metaAdId: ad.id,
            lastSyncAt: new Date(),
          })
          .where(eq(metaAd.id, pendingAdId));

        updated++;
      } else if (existingIsImported === undefined) {
        // New ad — import it
        const status = mapMetaAdStatus(ad.effectiveStatus);
        const cta = mapCallToAction(ad.creative?.callToActionType);

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
      } else if (existingIsImported) {
        // Existing imported ad — update its status from Meta
        const status = mapMetaAdStatus(ad.effectiveStatus);

        await db
          .update(metaAd)
          .set({
            status,
            metaStatus: ad.effectiveStatus,
            metaThumbnailUrl: ad.creative?.thumbnailUrl ?? undefined,
            lastSyncAt: new Date(),
          })
          .where(
            and(
              eq(metaAd.metaAdId, ad.id),
              eq(metaAd.organizationId, organizationId)
            )
          );

        updated++;
      }
      // For locally-created ads (isImported=false), don't update status —
      // those are managed by our own launch/publish flow.
    }

    if (imported > 0 || updated > 0) {
      logger.info(
        `Campaign ${metaCampaignId}: synced ${imported} new, ${updated} updated from Meta`
      );
    }
  } catch (error) {
    // Non-fatal: log and continue with local data
    logger.warn(
      `Failed to sync ads from Meta for campaign ${metaCampaignId}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
};

/**
 * Internal implementation
 */
const listAdsImpl = async (
  db: DbConnection,
  input: ListAdsInput
): Promise<Result<{ ads: typeof adsWithVideo; total: number }>> => {
  // Validate input
  const parsed = listAdsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { metaCampaignId, organizationId, status, limit, offset } = parsed.data;

  // Auto-sync ads from Meta when viewing a specific campaign
  if (metaCampaignId) {
    await syncCampaignAdsFromMeta(db, organizationId, metaCampaignId);
  }

  // Build where clause - filter by organization and optionally by campaign
  const whereConditions = [eq(metaAd.organizationId, organizationId)];
  if (metaCampaignId) {
    // Show ads for this campaign + unassigned imported ads
    const campaignFilter = or(
      eq(metaAd.metaCampaignId, metaCampaignId),
      isNull(metaAd.metaCampaignId)
    );
    if (campaignFilter) {
      whereConditions.push(campaignFilter);
    }
  }
  if (status) {
    whereConditions.push(eq(metaAd.status, status));
  }

  // Get ads with video info
  const ads = await db
    .select({
      id: metaAd.id,
      metaCampaignId: metaAd.metaCampaignId,
      metaAdSetId: metaAd.metaAdSetId,
      organizationId: metaAd.organizationId,
      videoId: metaAd.videoId,
      graphicId: metaAd.graphicId,
      name: metaAd.name,
      headline: metaAd.headline,
      primaryText: metaAd.primaryText,
      description: metaAd.description,
      callToAction: metaAd.callToAction,
      destinationUrl: metaAd.destinationUrl,
      status: metaAd.status,
      targetingOverride: metaAd.targetingOverride,
      metaAdId: metaAd.metaAdId,
      metaCreativeId: metaAd.metaCreativeId,
      metaVideoId: metaAd.metaVideoId,
      isImported: metaAd.isImported,
      // The twelve columns below are NOT decoration — they are the rest of the
      // declared response. `adSchema` (the `meta_ad` atom) requires every one,
      // and an explicit projection that omits a column sends no key at all, so
      // the browser received `undefined` where the contract promised a value
      // and `api-client` logged a ZodError for each one on every campaign load.
      //
      // It was not merely noisy. Consumers read these and get a WRONG ANSWER
      // rather than a missing one: `useExistingPost` arrives undefined, which
      // is falsy, so an existing-post ad looks like an ordinary one — the ad
      // panel offers to swap its creative and the server refuses. Same shape of
      // trap for `leadFormId` (destination lock) and `destinations`.
      //
      // Selecting columns explicitly is right; the list just has to match the
      // contract. `list-ads.contract.test.ts` now pins that.
      socialPostId: metaAd.socialPostId,
      useExistingPost: metaAd.useExistingPost,
      followUpType: metaAd.followUpType,
      leadFormId: metaAd.leadFormId,
      sequenceId: metaAd.sequenceId,
      adPlacement: metaAd.adPlacement,
      conversionDestination: metaAd.conversionDestination,
      destinations: metaAd.destinations,
      metaAdsPageId: metaAd.metaAdsPageId,
      adAccountId: metaAd.adAccountId,
      metaImageHash: metaAd.metaImageHash,
      metaPermalink: metaAd.metaPermalink,
      metaThumbnailUrl: metaAd.metaThumbnailUrl,
      metaStatus: metaAd.metaStatus,
      lastSyncAt: metaAd.lastSyncAt,
      syncError: metaAd.syncError,
      createdAt: metaAd.createdAt,
      updatedAt: metaAd.updatedAt,
      videoTitle: video.title,
      videoThumbnailUrl: video.thumbnailUrl,
      videoBlobUrl: video.blobUrl,
      videoDurationMs: video.durationMs,
    })
    .from(metaAd)
    .leftJoin(video, eq(metaAd.videoId, video.id))
    .where(and(...whereConditions))
    .orderBy(desc(metaAd.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(metaAd)
    .where(and(...whereConditions));

  // Batch-fetch services for all ads
  const adIds = ads.map((ad) => ad.id);
  const adServiceRows =
    adIds.length > 0
      ? await db
          .select({
            metaAdId: metaAdService.metaAdId,
            serviceId: organizationService.id,
            serviceName: organizationService.name,
          })
          .from(metaAdService)
          .innerJoin(
            organizationService,
            eq(metaAdService.serviceId, organizationService.id)
          )
          .where(inArray(metaAdService.metaAdId, adIds))
      : [];

  // Group services by ad ID
  const servicesByAdId = new Map<string, { id: string; name: string }[]>();
  for (const row of adServiceRows) {
    const existing = servicesByAdId.get(row.metaAdId) ?? [];
    existing.push({ id: row.serviceId, name: row.serviceName });
    servicesByAdId.set(row.metaAdId, existing);
  }

  // Batch-fetch the rendered image for graphic (image) ads so the UI can show
  // the full-res creative instead of Meta's tiny thumbnail. The controller
  // signs the URL/key for browser access.
  const graphicIds = [
    ...new Set(
      ads.map((ad) => ad.graphicId).filter((id): id is string => !!id)
    ),
  ];
  const graphicRows = graphicIds.length
    ? await db.query.graphic.findMany({
        where: inArray(graphic.id, graphicIds),
        columns: { id: true, outputs: true },
      })
    : [];
  const graphicFirstOutputById = new Map(
    graphicRows.map((g) => [g.id, g.outputs?.[0] ?? null])
  );

  // `videoId` can point at an ASSET rather than a video (the launch path has
  // always honoured both — see `resolveMediaAsset`). The join above only covers
  // `video`, so resolve the rest here or an asset-backed ad previews blank.
  const previewMediaById = await loadAdPreviewMediaByMediaId(
    db,
    ads
      .filter((ad) => !ad.videoBlobUrl && !ad.videoThumbnailUrl)
      .map((ad) => ad.videoId)
  );

  const adsWithVideo = ads.map((ad) => {
    const gOut = ad.graphicId ? graphicFirstOutputById.get(ad.graphicId) : null;
    const fallback = ad.videoId ? previewMediaById.get(ad.videoId) : undefined;
    return {
      ...ad,
      video: {
        title: ad.videoTitle ?? fallback?.title ?? null,
        thumbnailUrl:
          ad.videoThumbnailUrl || fallback?.thumbnailUrl || ad.metaThumbnailUrl,
        videoUrl: ad.videoBlobUrl ?? fallback?.videoUrl ?? null,
        duration: ad.videoDurationMs ?? fallback?.durationMs ?? null,
        width: fallback?.width ?? null,
        height: fallback?.height ?? null,
      },
      // Raw stored values — signed by the controller into `graphicImageUrl`.
      graphicImageUrl: gOut?.url ?? null,
      graphicImageKey: gOut?.objectKey ?? null,
      // Intrinsic size, so the preview frame is the right shape on first paint.
      graphicImageWidth: gOut?.width ?? null,
      graphicImageHeight: gOut?.height ?? null,
      services: servicesByAdId.get(ad.id) ?? [],
    };
  });

  return ok({ ads: adsWithVideo, total });
};

/**
 * List Meta ads for a campaign
 */
export const listAds = (db: DbConnection, input: ListAdsInput) =>
  trackedResult(
    'metaAds.listAds',
    () => withOrgScope((tx) => listAdsImpl(tx, input), { db }),
    {
      properties: { metaCampaignId: input.metaCampaignId },
    }
  );

/**
 * Result type for listAds
 */
export type ListAdsResult = Awaited<ReturnType<typeof listAds>>;
