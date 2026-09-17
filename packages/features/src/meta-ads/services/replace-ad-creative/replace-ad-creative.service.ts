import {
  asset,
  graphic,
  metaAd,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
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
import {
  type ReplaceAdCreativeInput,
  replaceAdCreativeSchema,
} from './replace-ad-creative.schema.js';

const replaceAdCreativeImpl = async (
  db: DbConnection,
  input: ReplaceAdCreativeInput
): Promise<Result<typeof metaAd.$inferSelect>> => {
  const parsed = replaceAdCreativeSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { adId, organizationId, videoId, graphicId } = parsed.data;
  const ad = await db.query.metaAd.findFirst({
    where: eq(metaAd.id, adId),
  });

  // Deliberately use the same not-found response for missing and cross-org
  // rows so this endpoint cannot be used to enumerate another org's ads.
  if (!ad || ad.organizationId !== organizationId) {
    return err(new FeatureError(AdErrorCodes.AD_NOT_FOUND, 'Ad not found'));
  }
  if (
    ad.status !== 'draft' ||
    ad.isImported ||
    ad.useExistingPost ||
    ad.metaAdId !== null
  ) {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'Creative can only be replaced on an unpublished Borradh draft ad'
      )
    );
  }

  if (graphicId) {
    const graphicRecord = await db.query.graphic.findFirst({
      where: and(
        eq(graphic.id, graphicId),
        eq(graphic.organizationId, organizationId)
      ),
      columns: { id: true },
    });
    if (!graphicRecord) {
      return err(
        new FeatureError(AdErrorCodes.VIDEO_NOT_FOUND, 'Graphic not found')
      );
    }
  }

  if (videoId) {
    const videoRecord = await db.query.video.findFirst({
      where: and(
        eq(video.id, videoId),
        eq(video.organizationId, organizationId),
        notDeleted(video)
      ),
      columns: { id: true },
    });
    const assetRecord = videoRecord
      ? undefined
      : await db.query.asset.findFirst({
          where: and(
            eq(asset.id, videoId),
            eq(asset.organizationId, organizationId),
            notDeleted(asset)
          ),
          columns: { id: true },
        });
    if (!videoRecord && !assetRecord) {
      return err(
        new FeatureError(AdErrorCodes.VIDEO_NOT_FOUND, 'Media not found')
      );
    }
  }

  const [updated] = await db
    .update(metaAd)
    .set({
      videoId: videoId ?? null,
      graphicId: graphicId ?? null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(metaAd.id, adId),
        eq(metaAd.organizationId, organizationId),
        eq(metaAd.status, 'draft')
      )
    )
    .returning();

  if (!updated) {
    return err(
      new FeatureError(
        AdErrorCodes.INVALID_AD_STATE,
        'The ad changed state before its creative could be replaced'
      )
    );
  }
  return ok(updated);
};

export const replaceAdCreative = (
  db: DbConnection,
  input: ReplaceAdCreativeInput
) =>
  trackedResult(
    'metaAds.replaceAdCreative',
    () => withOrgScope((tx) => replaceAdCreativeImpl(tx, input), { db }),
    { properties: { adId: input.adId } }
  );

export type ReplaceAdCreativeResult = Awaited<
  ReturnType<typeof replaceAdCreative>
>;
