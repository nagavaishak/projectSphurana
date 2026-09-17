import { asset } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { and, eq, inArray } from 'drizzle-orm';
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
  ASSET_PROBE_QUEUE,
  type AssetProbeJobPayload,
  type BackfillAssetProbesInput,
  type ReprobeAssetInput,
  backfillAssetProbesSchema,
  reprobeAssetSchema,
} from './probe-asset.schema.js';

let _queue: Queue | null = null;

export function getAssetProbeQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(ASSET_PROBE_QUEUE, {
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

const backfillAssetProbesImpl = async (
  db: DbConnection,
  input: BackfillAssetProbesInput
): Promise<Result<{ queued: number }>> => {
  const parsed = backfillAssetProbesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Include `failed` as well as `pending`: a failed ffprobe (e.g. the EACCES
  // installer-binary bug) leaves the asset permanently unusable with no retry
  // (ENG-375). Re-enqueuing failed probes lets a fixed worker recover them;
  // on success the probe processor cascades into transcode as normal.
  const conditions = [
    eq(asset.type, 'video'),
    inArray(asset.probeStatus, ['pending', 'failed']),
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

  const queue = getAssetProbeQueue();

  for (const a of assets) {
    try {
      await queue.add(
        'probe-asset',
        {
          assetId: a.id,
          organizationId: a.organizationId,
          blobUrl: a.blobUrl,
        } satisfies AssetProbeJobPayload,
        { jobId: `probe-${a.id}-${Date.now()}` }
      );
    } catch (error) {
      logError('assets.backfillAssetProbes.enqueue', error, {
        feature: 'assets',
        extra: { assetId: a.id },
      });
    }
  }

  return ok({ queued: assets.length });
};

export const backfillAssetProbes = (
  db: DbConnection,
  input: BackfillAssetProbesInput
) =>
  trackedResult(
    'assets.backfillAssetProbes',
    () => backfillAssetProbesImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

export type BackfillAssetProbesResult = Awaited<
  ReturnType<typeof backfillAssetProbes>
>;

/**
 * Re-probe a single video asset by id (ENG-375 admin/recovery trigger).
 *
 * Resets the asset back to `probeStatus='pending'` (and `transcodeStatus` to
 * 'pending' so the render gate keeps blocking until the cascade re-runs) and
 * enqueues a fresh probe job. Used to recover an asset whose probe failed and
 * is otherwise permanently unusable.
 */
const reprobeAssetImpl = async (
  db: DbConnection,
  input: ReprobeAssetInput
): Promise<Result<{ assetId: string }>> => {
  const parsed = reprobeAssetSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const conditions = [eq(asset.id, parsed.data.assetId), notDeleted(asset)];
  if (parsed.data.organizationId) {
    conditions.push(eq(asset.organizationId, parsed.data.organizationId));
  }

  const [target] = await db
    .select({
      id: asset.id,
      type: asset.type,
      blobUrl: asset.blobUrl,
      organizationId: asset.organizationId,
    })
    .from(asset)
    .where(and(...conditions))
    .limit(1);

  if (!target) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Asset not found'));
  }
  if (target.type !== 'video') {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Only video assets can be probed'
      )
    );
  }

  await db
    .update(asset)
    .set({ probeStatus: 'pending', transcodeStatus: 'pending' })
    .where(and(eq(asset.id, target.id), notDeleted(asset)));

  const queue = getAssetProbeQueue();
  await queue.add(
    'probe-asset',
    {
      assetId: target.id,
      organizationId: target.organizationId,
      blobUrl: target.blobUrl,
    } satisfies AssetProbeJobPayload,
    { jobId: `probe-${target.id}-${Date.now()}` }
  );

  return ok({ assetId: target.id });
};

export const reprobeAsset = (db: DbConnection, input: ReprobeAssetInput) =>
  trackedResult('assets.reprobeAsset', () => reprobeAssetImpl(db, input), {
    properties: { assetId: input.assetId },
  });

export type ReprobeAssetResult = Awaited<ReturnType<typeof reprobeAsset>>;
