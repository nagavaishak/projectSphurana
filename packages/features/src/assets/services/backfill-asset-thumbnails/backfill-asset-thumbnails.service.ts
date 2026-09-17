import { asset } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  ASSET_THUMBNAIL_QUEUE,
  type AssetThumbnailJobPayload,
  type BackfillAssetThumbnailsInput,
  backfillAssetThumbnailsSchema,
} from './backfill-asset-thumbnails.schema.js';

let _queue: Queue | null = null;

export function getAssetThumbnailQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(ASSET_THUMBNAIL_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _queue;
}

const backfillAssetThumbnailsImpl = async (
  db: DbConnection,
  input: BackfillAssetThumbnailsInput
): Promise<Result<{ queued: number }>> => {
  const parsed = backfillAssetThumbnailsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions = [
    eq(asset.type, 'video'),
    isNull(asset.thumbnailUrl),
    notDeleted(asset),
  ];
  if (parsed.data.organizationId) {
    conditions.push(eq(asset.organizationId, parsed.data.organizationId));
  }

  const assets = await db
    .select({
      id: asset.id,
      blobUrl: asset.blobUrl,
      organizationId: asset.organizationId,
    })
    .from(asset)
    .where(and(...conditions));

  if (assets.length === 0) {
    return ok({ queued: 0 });
  }

  const queue = getAssetThumbnailQueue();

  for (const a of assets) {
    try {
      await queue.add(
        'generate-thumbnail',
        {
          assetId: a.id,
          organizationId: a.organizationId,
          blobUrl: a.blobUrl,
        } satisfies AssetThumbnailJobPayload,
        {
          jobId: `thumb-${a.id}-${Date.now()}`,
        }
      );
    } catch (error) {
      logError('assets.backfillThumbnails.enqueue', error, {
        feature: 'assets',
        extra: { assetId: a.id },
      });
    }
  }

  return ok({ queued: assets.length });
};

export const backfillAssetThumbnails = (
  db: DbConnection,
  input: BackfillAssetThumbnailsInput
) =>
  trackedResult(
    'assets.backfillAssetThumbnails',
    () => backfillAssetThumbnailsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type BackfillAssetThumbnailsResult = Awaited<
  ReturnType<typeof backfillAssetThumbnails>
>;
