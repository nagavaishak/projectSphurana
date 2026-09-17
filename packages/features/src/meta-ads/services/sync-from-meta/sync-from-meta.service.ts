import { metaAd } from '@borradh-workspace/database';
import { getMetaErrorMessage } from '@borradh-workspace/integrations';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { dispatchNotification } from '../../../notifications/services/dispatch-notification/dispatch-notification.service.js';
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
  mapMetaAdStatus,
} from '../_shared/index.js';
import {
  type SyncAdStatusInput,
  syncAdStatusSchema,
} from './sync-from-meta.schema.js';

/**
 * Sync ad status from Meta
 */
const syncAdStatusImpl = async (
  db: DbConnection,
  input: SyncAdStatusInput
): Promise<Result<typeof metaAd.$inferSelect>> => {
  const parsed = syncAdStatusSchema.safeParse(input);
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

  // ORG CHECK FIRST. This used to sit BELOW the `!ad.metaAdId` check, which
  // made the pair an org-enumeration oracle: another org's UNPUBLISHED ad
  // returned 400 INVALID_AD_STATE ("Ad not published to Meta") while a
  // nonexistent id returned 404 — so a caller could distinguish "this id
  // exists, in someone else's org" from "this id does not exist", one guess at
  // a time. Every sibling route (get/update/delete/duplicate/replace-creative)
  // already answers a uniform 404.
  //
  // Nothing about an ad may be revealed — not even its publish state — before
  // ownership is established.
  if (ad.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }

  if (!ad.metaAdId) {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'Ad not published to Meta'
      )
    );
  }

  // Get credentials
  const credentialsResult = await getMetaCredentials(db, {
    organizationId,
    operationName: 'metaAds.syncAdStatus',
  });
  if (!credentialsResult.success) {
    return credentialsResult;
  }

  const metaService = new MetaAdsService(credentialsResult.data.credentials);

  try {
    const metaAd2 = await metaService.getAd(ad.metaAdId);

    // If Meta reports the ad as DELETED, remove it locally
    if (metaAd2.effectiveStatus === 'DELETED') {
      await db.delete(metaAd).where(eq(metaAd.id, ad.id));
      return err(
        new FeatureError(
          AdErrorCodes.AD_NOT_FOUND,
          'Ad was deleted on Meta and has been removed locally'
        )
      );
    }

    const newStatus = mapMetaAdStatus(metaAd2.effectiveStatus);

    const [updated] = await db
      .update(metaAd)
      .set({
        status: newStatus,
        metaStatus: metaAd2.effectiveStatus,
        // Always update thumbnail from Meta if available
        ...(metaAd2.thumbnailUrl
          ? { metaThumbnailUrl: metaAd2.thumbnailUrl }
          : {}),
        // Populate permalink if missing and now available from Meta
        ...(!ad.metaPermalink && metaAd2.permalinkUrl
          ? { metaPermalink: metaAd2.permalinkUrl }
          : {}),
        lastSyncAt: new Date(),
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, ad.id))
      .returning();

    // Fire-and-forget in-app notification on rejection transition
    if (newStatus === 'rejected' && ad.status !== 'rejected') {
      dispatchNotification(db, {
        organizationId,
        type: 'ad_rejected',
        title: 'Ad rejected',
        body: `Your ad "${ad.name}" was rejected by Meta.`,
        linkPath: '/dashboard/advertising',
      }).catch((error) =>
        logError('metaAds.syncAdStatus.dispatchNotification', error, {
          feature: 'meta-ads',
          extra: { adId, organizationId },
        })
      );
    }

    return ok(updated);
  } catch (error) {
    // Check if error indicates the ad was deleted
    const errorMessage = getMetaErrorMessage(error);
    if (
      errorMessage.includes('does not exist') ||
      errorMessage.includes('deleted')
    ) {
      // Ad was deleted on Meta, delete locally
      await db.delete(metaAd).where(eq(metaAd.id, ad.id));
      return err(
        new FeatureError(
          AdErrorCodes.AD_NOT_FOUND,
          'Ad was deleted on Meta and has been removed locally'
        )
      );
    }

    return await handleMetaError(error, {
      operationName: 'metaAds.syncAdStatus',
      extra: { adId, metaAdId: ad.metaAdId },
      defaultErrorCode: AdErrorCodes.META_SYNC_FAILED,
      defaultUserTitle: 'Failed to sync status',
      db,
      organizationId,
    });
  }
};

// Export trackedResult service
export const syncAdStatus = (db: DbConnection, input: SyncAdStatusInput) =>
  trackedResult('metaAds.syncAdStatus', () => syncAdStatusImpl(db, input), {
    properties: { adId: input.adId },
  });

export type SyncAdStatusResult = Awaited<ReturnType<typeof syncAdStatus>>;
