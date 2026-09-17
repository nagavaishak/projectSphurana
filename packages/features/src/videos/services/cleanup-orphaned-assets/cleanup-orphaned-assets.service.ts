import { asset, video, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { deleteObject, parseS3Url } from '@borradh-workspace/storage';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CleanupOrphanedAssetsInput,
  cleanupOrphanedAssetsSchema,
} from './cleanup-orphaned-assets.schema.js';

export interface CleanupOrphanedAssetsResponse {
  deletedCount: number;
  orphanedAssetIds: string[];
  errors: string[];
}

const cleanupOrphanedAssetsImpl = async (
  db: DbConnection,
  input: CleanupOrphanedAssetsInput
): Promise<Result<CleanupOrphanedAssetsResponse>> => {
  const parsed = cleanupOrphanedAssetsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, dryRun, minAgeHours } = parsed.data;

  try {
    // 1. Get all assets for this organization
    const allAssets = await db.query.asset.findMany({
      where: eq(asset.organizationId, organizationId),
      columns: { id: true, blobUrl: true, createdAt: true },
    });

    if (allAssets.length === 0) {
      return ok({ deletedCount: 0, orphanedAssetIds: [], errors: [] });
    }

    // 2. Get all videos and collect referenced asset IDs from draftConfig.bRollClips
    const allVideos = await db.query.video.findMany({
      where: eq(video.organizationId, organizationId),
      columns: { id: true, draftConfig: true },
    });

    const referencedAssetIds = new Set<string>();
    for (const v of allVideos) {
      if (v.draftConfig?.bRollClips) {
        for (const clip of v.draftConfig.bRollClips) {
          if (clip.assetId) {
            referencedAssetIds.add(clip.assetId);
          }
        }
      }
      // Also check talkingHeadAssetId
      if (v.draftConfig?.talkingHeadAssetId) {
        referencedAssetIds.add(v.draftConfig.talkingHeadAssetId);
      }
    }

    // 3. Find orphaned assets (not referenced by any video, older than minAgeHours)
    const ageCutoff = new Date(Date.now() - minAgeHours * 60 * 60 * 1000);
    const orphanedAssets = allAssets.filter(
      (a) =>
        !referencedAssetIds.has(a.id) &&
        (minAgeHours === 0 || a.createdAt <= ageCutoff)
    );

    if (orphanedAssets.length === 0) {
      return ok({ deletedCount: 0, orphanedAssetIds: [], errors: [] });
    }

    const orphanedAssetIds = orphanedAssets.map((a) => a.id);

    if (dryRun) {
      return ok({
        deletedCount: 0,
        orphanedAssetIds,
        errors: [],
      });
    }

    // 4. Delete orphaned assets
    const errors: string[] = [];
    let deletedCount = 0;

    for (const orphanedAsset of orphanedAssets) {
      try {
        // Delete S3 object
        if (orphanedAsset.blobUrl) {
          const s3Info = parseS3Url(orphanedAsset.blobUrl);
          if (s3Info) {
            await deleteObject({
              bucket: s3Info.bucket,
              key: s3Info.key,
            });
          }
        }

        // Delete DB record
        await db.delete(asset).where(eq(asset.id, orphanedAsset.id));
        deletedCount++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`Failed to delete asset ${orphanedAsset.id}: ${msg}`);
        logError('videos.cleanupOrphanedAssets', error, {
          feature: 'videos',
          extra: { assetId: orphanedAsset.id, organizationId },
        });
      }
    }

    return ok({ deletedCount, orphanedAssetIds, errors });
  } catch (error) {
    logError('videos.cleanupOrphanedAssets', error, {
      feature: 'videos',
      extra: { organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to cleanup orphaned assets'
      )
    );
  }
};

export const cleanupOrphanedAssets = (
  db: DbConnection,
  input: CleanupOrphanedAssetsInput
) =>
  trackedResult(
    'videos.cleanupOrphanedAssets',
    () => withOrgScope((tx) => cleanupOrphanedAssetsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      trackSuccess: false,
      trackFailure: false,
    }
  );

export type CleanupOrphanedAssetsResult = Awaited<
  ReturnType<typeof cleanupOrphanedAssets>
>;
