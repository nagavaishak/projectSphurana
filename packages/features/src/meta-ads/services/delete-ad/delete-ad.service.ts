import {
  metaAd,
  metaCampaignConfig,
  withOrgScope,
} from '@borradh-workspace/database';
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
import { getMetaCredentials } from '../_shared/get-meta-credentials.js';
import { logMetaErrorIfUnknown } from '../_shared/handle-meta-error.js';
import { type DeleteAdInput, deleteAdSchema } from './delete-ad.schema.js';

/**
 * Internal implementation
 */
const deleteAdImpl = async (
  db: DbConnection,
  input: DeleteAdInput
): Promise<Result<{ deleted: true }>> => {
  // Validate input
  const parsed = deleteAdSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId } = parsed.data;

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

  // If ad is synced to Meta, delete it there first — using the ad's own
  // page/ad-account snapshot, not the integration default (under FLfB an org
  // can have multiple pages + ad accounts, and deleting against the default
  // account would silently no-op for ads living elsewhere).
  if (ad.metaAdId) {
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
      operationName: 'metaAds.deleteAd',
    });

    if (credResult.success) {
      try {
        const metaService = new MetaAdsService(credResult.data.credentials);

        // Delete ad from Meta (also deletes creative)
        await metaService.deleteAd(ad.metaAdId);
      } catch (error) {
        // Log but don't fail — ad might already be deleted on Meta
        logMetaErrorIfUnknown('metaAds.deleteAd', error, {
          adId,
          metaAdId: ad.metaAdId,
        });
      }
    }
  }

  // Delete ad from database
  await db.delete(metaAd).where(eq(metaAd.id, adId));

  return ok({ deleted: true });
};

/**
 * Delete a Meta ad
 */
export const deleteAd = (db: DbConnection, input: DeleteAdInput) =>
  trackedResult(
    'metaAds.deleteAd',
    () => withOrgScope((tx) => deleteAdImpl(tx, input), { db }),
    {
      properties: { adId: input.adId },
    }
  );

/**
 * Result type for deleteAd
 */
export type DeleteAdResult = Awaited<ReturnType<typeof deleteAd>>;
