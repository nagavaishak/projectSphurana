import {
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
import { getMetaErrorMessage } from '@borradh-workspace/integrations';
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
  buildAdCreative,
  getMetaCredentials,
  handleMetaError,
  setAdError,
} from '../_shared/index.js';
import { type UpdateAdInput, updateAdSchema } from './update-ad.schema.js';

const CREATIVE_FIELDS = [
  'headline',
  'primaryText',
  'description',
  'callToAction',
  'destinationUrl',
] as const;

/**
 * Internal implementation
 */
const updateAdImpl = async (
  db: DbConnection,
  input: UpdateAdInput
): Promise<Result<typeof metaAd.$inferSelect>> => {
  // Validate input
  const parsed = updateAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId, ...updateData } = parsed.data;

  // Get ad
  const ad = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adId),
  });

  if (!ad) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Verify organization access directly on the ad
  if (ad.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  // Check if ad can be updated
  if (ad.status === 'rejected') {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'Cannot update a rejected ad. Please create a new ad.'
      )
    );
  }

  // Build update object only with provided fields
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (updateData.name !== undefined) updates.name = updateData.name;
  if (updateData.headline !== undefined) updates.headline = updateData.headline;
  if (updateData.primaryText !== undefined)
    updates.primaryText = updateData.primaryText;
  if (updateData.description !== undefined)
    updates.description = updateData.description;
  if (updateData.callToAction !== undefined)
    updates.callToAction = updateData.callToAction;
  if (updateData.destinationUrl !== undefined)
    updates.destinationUrl = updateData.destinationUrl;
  if (updateData.targetingOverride !== undefined)
    updates.targetingOverride = updateData.targetingOverride;

  // Update ad in database
  const [result] = await db
    .update(metaAd)
    .set(updates)
    .where(eq(metaAd.id, adId))
    .returning();

  // --- Meta sync for published ads ---

  // Skip if ad is not published on Meta
  if (!ad.metaAdId) {
    return ok(result);
  }

  // Determine what changed
  const nameChanged = updateData.name !== undefined;
  const creativeFieldsChanged = CREATIVE_FIELDS.some(
    (f) => updateData[f] !== undefined
  );

  // Nothing to sync to Meta
  if (!nameChanged && !creativeFieldsChanged) {
    return ok(result);
  }

  // useExistingPost ads can only update name on Meta
  if (ad.useExistingPost && creativeFieldsChanged) {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'Cannot update creative fields on an ad created from an existing post. Only the ad name can be changed.'
      )
    );
  }

  // Imported ads without media references cannot rebuild creatives
  if (creativeFieldsChanged && !ad.metaVideoId && !ad.metaImageHash) {
    return err(
      new FeatureError(
        AdErrorCodes.META_SYNC_FAILED,
        'Cannot update creative for this ad. Media references are missing.'
      )
    );
  }

  // Get Meta credentials
  const campaignConfig = ad.metaCampaignId
    ? await db.query.metaCampaignConfig.findFirst({
        where: eq(metaCampaignConfig.metaCampaignId, ad.metaCampaignId),
      })
    : null;

  const credResult = await getMetaCredentials(db, {
    organizationId,
    metaAdsPageId: ad.metaAdsPageId ?? undefined,
    adAccountId: campaignConfig?.adAccountId ?? undefined,
    requireConfigured: false,
    operationName: 'metaAds.updateAd',
  });
  if (!credResult.success) return credResult;

  const { credentials, resolvedPage } = credResult.data;
  const metaService = new MetaAdsService(credentials);

  try {
    const metaUpdates: {
      name?: string;
      creative?: { creative_id: string };
    } = {};

    if (nameChanged) {
      metaUpdates.name = updateData.name;
    }

    if (creativeFieldsChanged) {
      // Create a new creative with updated fields (creatives are immutable on
      // Meta). Route through the SHARED builder rather than building the
      // object_story_spec inline — the inline version drifted and dropped two
      // Meta-required fields:
      //   • the top-level image `link` (ENG-212: "The link field is required")
      //   • the video `image_url` thumbnail (ENG-230: "Please specify one of
      //     image_hash or image_url in the video_data field")
      // The builder also keeps the CTA messaging-aware and attaches the IG
      // actor + degrees-of-freedom spec, so the edit path matches the launch
      // path exactly.
      const creativeResult = await buildAdCreative(db, metaService, {
        adRecord: result,
        organizationId,
        resolvedPage,
        metaVideoId: ad.metaVideoId,
        metaImageHash: ad.metaImageHash,
        videoThumbnailUrl: ad.metaThumbnailUrl ?? undefined,
      });
      if (!creativeResult.success) {
        await setAdError(db, adId, creativeResult.error.message);
        return creativeResult;
      }
      const newCreativeId = creativeResult.data.creativeId;

      metaUpdates.creative = { creative_id: newCreativeId };

      // Update local creative reference
      await db
        .update(metaAd)
        .set({
          metaCreativeId: newCreativeId,
          lastSyncAt: new Date(),
          syncError: null,
          updatedAt: new Date(),
        })
        .where(eq(metaAd.id, adId));
    }

    // Push updates to Meta
    await metaService.updateAd(ad.metaAdId, metaUpdates);

    return ok(result);
  } catch (error) {
    // Keep DB changes (user's intent), but record sync error
    const errorMessage = getMetaErrorMessage(error);
    await setAdError(db, adId, errorMessage);

    return handleMetaError(error, {
      operationName: 'metaAds.updateAd',
      credentials: { pageId: credentials.pageId },
      extra: { organizationId, adId },
      defaultUserTitle: 'Failed to sync ad update to Meta',
      db,
      organizationId,
    });
  }
};

/**
 * Update a Meta ad
 */
export const updateAd = (db: DbConnection, input: UpdateAdInput) =>
  trackedResult(
    'metaAds.updateAd',
    () => withOrgScope((tx) => updateAdImpl(tx, input), { db }),
    {
      properties: { adId: input.adId },
    }
  );

/**
 * Result type for updateAd
 */
export type UpdateAdResult = Awaited<ReturnType<typeof updateAd>>;
