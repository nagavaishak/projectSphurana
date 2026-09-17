import {
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { metaCallToActionValues } from '@borradh-workspace/labels';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  getMetaCredentials,
  handleMetaError,
  linkServicesToAd,
  logMetaErrorIfUnknown,
} from '../../../meta-ads/services/_shared/index.js';
import { ensureCampaignConfig } from '../../../meta-ads/services/ensure-campaign-config/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  type DuplicateCampaignInput,
  duplicateCampaignSchema,
} from './duplicate-campaign.schema.js';

const COPY_SUFFIX = ' (Copy)';
const logger = createLogger('DuplicateCampaign');

const isLive = (status?: string): boolean =>
  status !== 'ARCHIVED' && status !== 'DELETED';

const mapCallToAction = (
  ctaType: string | undefined
): (typeof metaCallToActionValues)[number] => {
  if (
    ctaType &&
    (metaCallToActionValues as readonly string[]).includes(ctaType)
  ) {
    return ctaType as (typeof metaCallToActionValues)[number];
  }
  return 'LEARN_MORE';
};

export interface DuplicateCampaignResponse {
  metaCampaignId: string;
  metaAdSetId: string | null;
  adsCopied: number;
}

/**
 * Internal implementation
 */
const duplicateCampaignImpl = async (
  db: DbConnection,
  input: DuplicateCampaignInput
): Promise<Result<DuplicateCampaignResponse>> => {
  const parsed = duplicateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { metaCampaignId, organizationId } = parsed.data;

  // Make sure the source campaign has a local config (imported campaigns won't)
  // so we can resolve its page/account snapshot and clone its settings.
  await ensureCampaignConfig(db, { organizationId, metaCampaignId });

  const sourceConfig = await db.query.metaCampaignConfig.findFirst({
    where: eq(metaCampaignConfig.metaCampaignId, metaCampaignId),
  });
  if (!sourceConfig || sourceConfig.organizationId !== organizationId) {
    return err(
      new FeatureError(
        CampaignErrorCodes.CAMPAIGN_NOT_FOUND,
        'Campaign not found.'
      )
    );
  }

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: sourceConfig.metaAdsPageId,
    adAccountId: sourceConfig.adAccountId,
    operationName: 'metaCampaigns.duplicateCampaign',
  });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  // Tracked outside the try so we can clean up a half-built copy on failure.
  let copiedCampaignId: string | undefined;

  try {
    // Meta's synchronous /copies rejects copying 3+ ad objects at once, so we
    // rebuild the campaign one object at a time. Everything is created PAUSED.

    // ---- Read the source structure up front (all Meta GETs) ----
    const sourceAdSets = (await metaService.listAdSets(metaCampaignId)).filter(
      (s) => isLive(s.effectiveStatus ?? s.status)
    );

    let sourceAds = (
      await metaService.listCampaignAdsWithCreative(metaCampaignId)
    ).filter((a) => isLive(a.effectiveStatus));

    // Fallback: if the campaign-scoped ad listing came back empty, derive the
    // ads from the account-wide listing filtered to this campaign. Guards
    // against the campaign /ads edge returning nothing for some campaigns.
    if (sourceAds.length === 0) {
      const allAds = await metaService.listAllAdsWithCreative(200);
      sourceAds = allAds.filter(
        (a) => a.campaignId === metaCampaignId && isLive(a.effectiveStatus)
      );
    }

    // Union of ad set ids to copy: those Meta lists for the campaign PLUS any
    // referenced by an ad (covers a stale/empty listAdSets response).
    const adSetIds = new Set<string>(sourceAdSets.map((s) => s.id));
    for (const ad of sourceAds) {
      if (ad.adsetId) adSetIds.add(ad.adsetId);
    }

    logger.info(
      `Duplicating campaign ${metaCampaignId}: ${adSetIds.size} ad set(s), ${sourceAds.length} ad(s) to copy`
    );

    // ---- 1. Shallow-copy the campaign (fatal if this fails) ----
    const campaignCopy = await metaService.copyCampaign(metaCampaignId, {
      deepCopy: false,
      statusOption: 'PAUSED',
      renameSuffix: COPY_SUFFIX,
    });
    copiedCampaignId = campaignCopy.copiedCampaignId;

    // ---- 2. Copy each ad set into the new campaign (per-set non-fatal) ----
    const adSetMap = new Map<string, string>();
    for (const sourceAdSetId of adSetIds) {
      try {
        const { copiedAdSetId } = await metaService.copyAdSet(sourceAdSetId, {
          campaignId: copiedCampaignId,
          statusOption: 'PAUSED',
        });
        adSetMap.set(sourceAdSetId, copiedAdSetId);
      } catch (adSetError) {
        logMetaErrorIfUnknown(
          'metaCampaigns.duplicateCampaign.copyAdSet',
          adSetError,
          { metaCampaignId, copiedCampaignId, sourceAdSetId, organizationId }
        );
      }
    }
    const primaryNewAdSetId =
      (sourceAdSets[0]?.id ? adSetMap.get(sourceAdSets[0].id) : undefined) ??
      [...adSetMap.values()][0] ??
      null;

    // ---- 3. Clone the source config onto the new campaign ----
    // Upsert: a concurrent meta-sync backfill enumerates all campaigns (incl.
    // this just-created copy) and may insert a config row first. Our cloned
    // values are more accurate than the backfill's inferred ones, so on
    // conflict we overwrite rather than 500 on the unique constraint.
    const clonedConfig = {
      metaAdsPageId: sourceConfig.metaAdsPageId,
      adAccountId: sourceConfig.adAccountId,
      adAccountCurrency: sourceConfig.adAccountCurrency,
      followUpType: sourceConfig.followUpType,
      conversionDestination: sourceConfig.conversionDestination,
      destinationType: sourceConfig.destinationType,
      leadFormId: sourceConfig.leadFormId,
      locationId: sourceConfig.locationId,
      targeting: sourceConfig.targeting,
      metaAdSetId: primaryNewAdSetId,
    };
    await db
      .insert(metaCampaignConfig)
      .values({
        metaCampaignId: copiedCampaignId,
        organizationId,
        ...clonedConfig,
      })
      .onConflictDoUpdate({
        target: metaCampaignConfig.metaCampaignId,
        set: { ...clonedConfig, updatedAt: new Date() },
      });

    // ---- 4. Copy each ad into its mapped new ad set (per-ad non-fatal) ----
    // Pre-load the LOCAL source ad rows so each copy is a faithful clone — it
    // inherits the source's local creative (videoId/graphicId), isImported flag
    // and creative fields, so a copy of a normal ad looks like a normal ad
    // (local thumbnail, no "Imported" badge) and a copy of an imported ad stays
    // imported. Also carries over service links.
    const sourceAdMetaIds = sourceAds.map((a) => a.id);
    const localSources = sourceAdMetaIds.length
      ? await db.query.metaAd.findMany({
          where: and(
            eq(metaAd.organizationId, organizationId),
            inArray(metaAd.metaAdId, sourceAdMetaIds)
          ),
          with: { services: true },
        })
      : [];
    const localBySourceMetaId = new Map(
      localSources.map((a) => [a.metaAdId, a])
    );
    const servicesBySourceMetaId = new Map(
      localSources.map((a) => [a.metaAdId, a.services.map((s) => s.serviceId)])
    );

    let adsCopied = 0;
    for (const ad of sourceAds) {
      const targetAdSetId =
        (ad.adsetId ? adSetMap.get(ad.adsetId) : undefined) ??
        primaryNewAdSetId;
      if (!targetAdSetId) {
        logger.warn(
          `Skipping ad ${ad.id}: no target ad set (source ad set ${ad.adsetId ?? 'none'} was not copied)`
        );
        continue;
      }

      try {
        const { copiedAdId } = await metaService.copyAd(ad.id, {
          adSetId: targetAdSetId,
          statusOption: 'PAUSED',
        });

        // A concurrent meta-sync import may already have created a local row
        // for the freshly-copied ad (it's now live on Meta). metaAd.metaAdId
        // has no unique constraint, so guard against a duplicate row here.
        const existing = await db.query.metaAd.findFirst({
          where: eq(metaAd.metaAdId, copiedAdId),
          columns: { id: true },
        });
        if (existing) {
          await linkServicesToAd(
            db,
            existing.id,
            servicesBySourceMetaId.get(ad.id) ?? []
          );
          adsCopied++;
          continue;
        }

        // Clone the local source row when we have one; otherwise (a purely
        // remote/never-imported source ad) fall back to the Meta creative data.
        const src = localBySourceMetaId.get(ad.id);
        const creativeFields = src
          ? {
              videoId: src.videoId,
              graphicId: src.graphicId,
              socialPostId: src.socialPostId,
              useExistingPost: src.useExistingPost,
              name: src.name,
              headline: src.headline,
              primaryText: src.primaryText,
              description: src.description,
              callToAction: src.callToAction,
              destinationUrl: src.destinationUrl,
              followUpType: src.followUpType,
              leadFormId: src.leadFormId,
              sequenceId: src.sequenceId,
              adPlacement: src.adPlacement,
              conversionDestination: src.conversionDestination,
              destinations: src.destinations,
              targetingOverride: src.targetingOverride,
              isImported: src.isImported,
              metaThumbnailUrl: src.metaThumbnailUrl,
            }
          : {
              videoId: null,
              graphicId: null,
              name: ad.name,
              headline: ad.creative?.title ?? null,
              primaryText: ad.creative?.body ?? null,
              description: ad.creative?.linkDescription ?? null,
              callToAction: mapCallToAction(ad.creative?.callToActionType),
              destinationUrl: ad.creative?.linkUrl ?? null,
              followUpType: sourceConfig.followUpType,
              leadFormId:
                sourceConfig.followUpType === 'lead_form'
                  ? sourceConfig.leadFormId
                  : null,
              // No local creative — render from Meta's thumbnail like an import.
              isImported: true,
              metaThumbnailUrl: ad.creative?.thumbnailUrl ?? null,
            };

        const [newAd] = await db
          .insert(metaAd)
          .values({
            organizationId,
            metaCampaignId: copiedCampaignId,
            metaAdSetId: targetAdSetId,
            ...creativeFields,
            // The copy is a fresh Meta object — let the next sync fill in the
            // new creative/video ids; keep our own status as PAUSED.
            status: 'paused',
            metaAdId: copiedAdId,
            metaVideoId: ad.creative?.videoId ?? null,
            metaStatus: 'PAUSED',
            metaAdsPageId: sourceConfig.metaAdsPageId,
            adAccountId: sourceConfig.adAccountId,
            lastSyncAt: new Date(),
          })
          .returning();

        await linkServicesToAd(
          db,
          newAd.id,
          servicesBySourceMetaId.get(ad.id) ?? []
        );
        adsCopied++;
      } catch (adError) {
        logMetaErrorIfUnknown(
          'metaCampaigns.duplicateCampaign.copyAd',
          adError,
          {
            metaCampaignId,
            copiedCampaignId,
            sourceAdId: ad.id,
            targetAdSetId,
            organizationId,
          }
        );
      }
    }

    logger.info(
      `Duplicated campaign ${metaCampaignId} → ${copiedCampaignId}: ${adSetMap.size}/${adSetIds.size} ad sets, ${adsCopied}/${sourceAds.length} ads`
    );

    return ok({
      metaCampaignId: copiedCampaignId,
      metaAdSetId: primaryNewAdSetId,
      adsCopied,
    });
  } catch (error) {
    // Delete the half-built copy so a retry starts clean (it's PAUSED, but an
    // orphaned partial campaign is confusing). Best-effort.
    if (copiedCampaignId) {
      try {
        await metaService.deleteCampaign(copiedCampaignId);
      } catch (cleanupError) {
        logMetaErrorIfUnknown(
          'metaCampaigns.duplicateCampaign.cleanup',
          cleanupError,
          { metaCampaignId: copiedCampaignId, organizationId }
        );
      }
    }

    return handleMetaError(error, {
      operationName: 'metaCampaigns.duplicateCampaign',
      credentials: { pageId: credResult.data.credentials.pageId },
      extra: { organizationId, metaCampaignId },
      defaultErrorCode: CampaignErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to Duplicate Campaign',
      db,
      organizationId,
    });
  }
};

/**
 * Duplicate a Meta campaign and all of its ads. Rebuilds the campaign object by
 * object (Meta's sync deep-copy caps at <3 objects), all created PAUSED, and
 * writes a local config + ad rows so it's immediately usable in the app.
 *
 * Long-running (one Meta call per ad object) — invoked from the
 * `meta-campaign-duplicate` worker, not the API request path.
 */
export const duplicateCampaign = (
  db: DbConnection,
  input: DuplicateCampaignInput
) =>
  trackedResult(
    'metaCampaigns.duplicateCampaign',
    () => withOrgScope((tx) => duplicateCampaignImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
    }
  );

export type DuplicateCampaignResult = Awaited<
  ReturnType<typeof duplicateCampaign>
>;
