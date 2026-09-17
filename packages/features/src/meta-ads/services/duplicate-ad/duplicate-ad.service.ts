import { metaAd, withOrgScope } from '@borradh-workspace/database';
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
  getMetaCredentials,
  handleMetaError,
  linkServicesToAd,
  mapMetaAdStatus,
} from '../_shared/index.js';
import {
  type DuplicateAdInput,
  duplicateAdSchema,
} from './duplicate-ad.schema.js';

const COPY_SUFFIX = ' (Copy)';

/**
 * Internal implementation
 */
const duplicateAdImpl = async (
  db: DbConnection,
  input: DuplicateAdInput
): Promise<Result<typeof metaAd.$inferSelect>> => {
  const parsed = duplicateAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId } = parsed.data;

  const source = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adId),
    with: { services: true },
  });

  if (!source || source.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  const serviceIds = source.services.map((s) => s.serviceId);

  // When we hold the creative locally (Borradh-made ads — video / graphic /
  // existing post), duplicate as a fresh DRAFT cloned from the local row rather
  // than via Meta's /copies. This (a) avoids Meta re-validating an older
  // creative on copy — e.g. rejecting the now-deprecated `standard_enhancements`
  // field — and (b) keeps the duplicate a first-class local ad (not flagged
  // "Imported"). The user launches it when ready. (Insert inline rather than
  // calling createAd so we don't nest withOrgScope.)
  if (source.videoId || source.graphicId || source.socialPostId) {
    const [draft] = await db
      .insert(metaAd)
      .values({
        metaCampaignId: source.metaCampaignId,
        organizationId,
        videoId: source.videoId,
        graphicId: source.graphicId,
        socialPostId: source.socialPostId,
        useExistingPost: source.useExistingPost,
        name: `${source.name}${COPY_SUFFIX}`,
        headline: source.headline,
        primaryText: source.primaryText,
        description: source.description,
        callToAction: source.callToAction,
        destinationUrl: source.destinationUrl,
        targetingOverride: source.targetingOverride,
        followUpType: source.followUpType,
        leadFormId: source.leadFormId,
        sequenceId: source.sequenceId,
        adPlacement: source.adPlacement,
        conversionDestination: source.conversionDestination,
        destinations: source.destinations,
        metaAdsPageId: source.metaAdsPageId,
        isImported: false,
        status: 'draft',
      })
      .returning();

    await linkServicesToAd(db, draft.id, serviceIds);
    return ok(draft);
  }

  // No local creative — the ad was imported from Meta, so we can only duplicate
  // it via Meta's server-side /copies (we don't hold the creative to rebuild).
  if (!source.metaAdId) {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'This ad has no creative to duplicate.'
      )
    );
  }

  // Imported ad — copy it server-side on Meta. The copy is created PAUSED so it
  // never spends before the user reviews it.
  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: source.metaAdsPageId,
    adAccountId: source.adAccountId ?? undefined,
    operationName: 'metaAds.duplicateAd',
  });
  if (!credResult.success) return credResult;

  const metaService = new MetaAdsService(credResult.data.credentials);

  try {
    const { copiedAdId } = await metaService.copyAd(source.metaAdId, {
      adSetId: source.metaAdSetId ?? undefined,
      statusOption: 'PAUSED',
      renameSuffix: COPY_SUFFIX,
    });

    // Fetch the copy's live status + thumbnail so the new row mirrors Meta.
    let metaStatus: string | undefined;
    let metaThumbnailUrl: string | null = source.metaThumbnailUrl;
    let metaPermalink: string | null = null;
    try {
      const copied = await metaService.getAd(copiedAdId);
      metaStatus = copied.effectiveStatus;
      metaThumbnailUrl = copied.thumbnailUrl ?? source.metaThumbnailUrl;
      metaPermalink = copied.permalinkUrl ?? null;
    } catch {
      // Non-fatal — the next sync will fill these in.
    }

    const [newAd] = await db
      .insert(metaAd)
      .values({
        metaCampaignId: source.metaCampaignId,
        metaAdSetId: source.metaAdSetId,
        organizationId,
        videoId: source.videoId,
        graphicId: source.graphicId,
        socialPostId: source.socialPostId,
        useExistingPost: source.useExistingPost,
        name: `${source.name}${COPY_SUFFIX}`,
        headline: source.headline,
        primaryText: source.primaryText,
        description: source.description,
        callToAction: source.callToAction,
        destinationUrl: source.destinationUrl,
        // The copy is a fresh Meta ad we don't hold creative for locally —
        // treat it like an imported ad so the UI renders from Meta's thumbnail.
        isImported: true,
        status: metaStatus ? mapMetaAdStatus(metaStatus) : 'paused',
        targetingOverride: source.targetingOverride,
        followUpType: source.followUpType,
        leadFormId: source.leadFormId,
        sequenceId: source.sequenceId,
        adPlacement: source.adPlacement,
        conversionDestination: source.conversionDestination,
        destinations: source.destinations,
        metaAdsPageId: source.metaAdsPageId,
        adAccountId: source.adAccountId,
        metaAdId: copiedAdId,
        metaStatus: metaStatus ?? null,
        metaThumbnailUrl,
        metaPermalink,
        lastSyncAt: new Date(),
      })
      .returning();

    await linkServicesToAd(db, newAd.id, serviceIds);

    return ok(newAd);
  } catch (error) {
    return handleMetaError(error, {
      operationName: 'metaAds.duplicateAd',
      credentials: credResult.data.credentials,
      extra: { organizationId, adId, metaAdId: source.metaAdId },
      defaultUserTitle: 'Failed to duplicate ad',
      db,
      organizationId,
    });
  }
};

/**
 * Duplicate a Meta ad.
 *
 * - Ads with a local creative (Borradh-made — video / graphic / existing post)
 *   are cloned as a fresh DRAFT from the local row. This avoids Meta
 *   re-validating an older creative on copy and keeps the duplicate a
 *   first-class local ad. The user launches it when ready.
 * - Imported ads (no local creative) are copied server-side on Meta via the
 *   `/copies` edge, created PAUSED.
 */
export const duplicateAd = (db: DbConnection, input: DuplicateAdInput) =>
  trackedResult(
    'metaAds.duplicateAd',
    () => withOrgScope((tx) => duplicateAdImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId, adId: input.adId },
    }
  );

export type DuplicateAdResult = Awaited<ReturnType<typeof duplicateAd>>;
