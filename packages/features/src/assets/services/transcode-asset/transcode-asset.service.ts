import { asset } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
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
import {
  ASSET_TRANSCODE_QUEUE,
  type AssetTranscodeJobPayload,
  type BackfillAssetTranscodesInput,
  backfillAssetTranscodesSchema,
} from './transcode-asset.schema.js';

let _queue: Queue | null = null;

export function getAssetTranscodeQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(ASSET_TRANSCODE_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });
  }
  return _queue;
}

const backfillAssetTranscodesImpl = async (
  db: DbConnection,
  input: BackfillAssetTranscodesInput
): Promise<Result<{ queued: number }>> => {
  const parsed = backfillAssetTranscodesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions = [
    eq(asset.type, 'video'),
    eq(asset.transcodeStatus, 'pending'),
    eq(asset.probeStatus, 'ready'),
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

  const queue = getAssetTranscodeQueue();

  for (const a of assets) {
    try {
      await queue.add(
        'transcode-asset',
        {
          assetId: a.id,
          organizationId: a.organizationId,
          blobUrl: a.blobUrl,
        } satisfies AssetTranscodeJobPayload,
        { jobId: `transcode-${a.id}-${Date.now()}` }
      );
    } catch (error) {
      logError('assets.backfillAssetTranscodes.enqueue', error, {
        feature: 'assets',
        extra: { assetId: a.id },
      });
    }
  }

  return ok({ queued: assets.length });
};

export const backfillAssetTranscodes = (
  db: DbConnection,
  input: BackfillAssetTranscodesInput
) =>
  trackedResult(
    'assets.backfillAssetTranscodes',
    () => backfillAssetTranscodesImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type BackfillAssetTranscodesResult = Awaited<
  ReturnType<typeof backfillAssetTranscodes>
>;
