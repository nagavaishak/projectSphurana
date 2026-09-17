/**
 * Asset Thumbnail Processor
 *
 * Processes thumbnail generation jobs from the 'asset-thumbnail' queue.
 * Downloads video assets, extracts a middle frame via FFmpeg, uploads to S3,
 * and updates the asset record with the thumbnail URL.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { asset, db, withSystemScope } from '@borradh-workspace/database';
import {
  ASSET_THUMBNAIL_QUEUE,
  type AssetThumbnailJobPayload,
} from '@borradh-workspace/features/assets';
import {
  isTerminalFailure,
  moveToDeadLetter,
} from '@borradh-workspace/features/shared/queue';
import {
  type Logger,
  createLogger,
  logError,
} from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import {
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  parseS3Url,
  upload,
} from '@borradh-workspace/storage';
import { getPrivateCdnUrl, isCdnEnabled } from '@borradh-workspace/storage';
import { extractKeyFrames } from '@borradh-workspace/video-processing/ffmpeg';
import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { downloadToFile } from './lib/download.js';

let log: Logger;

async function presignUrl(blobUrl: string): Promise<string> {
  const s3Info = parseS3Url(blobUrl);
  if (s3Info) {
    return getPresignedDownloadUrl({
      bucket: s3Info.bucket,
      key: s3Info.key,
      expiresIn: 3600,
    });
  }

  const url = new URL(blobUrl);
  const key = url.pathname.startsWith('/')
    ? url.pathname.slice(1)
    : url.pathname;
  return getPresignedDownloadUrl({
    bucket: getOrgAssetsBucket(),
    key,
    expiresIn: 3600,
  });
}

async function processAssetThumbnailJob(
  job: Job<AssetThumbnailJobPayload>
): Promise<void> {
  const { assetId, organizationId, blobUrl } = job.data;
  const tempDir = path.join(
    os.tmpdir(),
    `asset-thumb-${assetId}-${Date.now()}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    log.info(`Generating thumbnail for asset ${assetId}`);

    // Download video
    const downloadUrl = await presignUrl(blobUrl);
    const tempVideoPath = path.join(tempDir, 'video.mp4');
    await downloadToFile(downloadUrl, tempVideoPath);

    // Extract middle frame
    const framePaths = await extractKeyFrames(tempVideoPath, {
      count: 1,
      outputDir: tempDir,
      quality: 3,
    });

    if (framePaths.length === 0) {
      throw new Error('No frames extracted');
    }

    // Upload to S3
    const thumbnailKey = `${organizationId}/assets/thumbnails/${assetId}.jpg`;
    const orgBucket = getOrgAssetsBucket();
    const frameBuffer = fs.readFileSync(framePaths[0]);

    await upload({
      bucket: orgBucket,
      key: thumbnailKey,
      body: frameBuffer,
      contentType: 'image/jpeg',
    });

    const thumbnailUrl = isCdnEnabled()
      ? getPrivateCdnUrl(thumbnailKey)
      : `https://${orgBucket}.s3.amazonaws.com/${thumbnailKey}`;

    // Update asset record
    await withSystemScope(
      (conn) =>
        conn.update(asset).set({ thumbnailUrl }).where(eq(asset.id, assetId)),
      { db }
    );

    log.info(`Thumbnail generated for asset ${assetId}: ${thumbnailUrl}`);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function createAssetThumbnailWorker(): Worker<AssetThumbnailJobPayload> {
  log = createLogger('asset-thumbnail');

  const redis = getRedis();

  log.info('Starting asset thumbnail worker...');

  const worker = new Worker<AssetThumbnailJobPayload>(
    ASSET_THUMBNAIL_QUEUE,
    async (job) => {
      await processAssetThumbnailJob(job);
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: 1,
      lockDuration: 300_000, // 5 min per job
      stalledInterval: 60_000,
    }
  );

  worker.on('completed', (job) => {
    log.info(`Job completed: ${job.id}`);
  });

  worker.on('failed', async (job, error) => {
    logError('asset-thumbnail.jobFailed', error, {
      feature: 'asset-thumbnail',
      extra: { jobId: job?.id, assetId: job?.data.assetId },
    });

    // PRD-40: dead-letter + alert on terminal failure so a permanently missing
    // thumbnail surfaces instead of the job silently rotating out of Redis.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: ASSET_THUMBNAIL_QUEUE,
        job,
        error,
        context: {
          assetId: job.data?.assetId,
          organizationId: job.data?.organizationId,
        },
      });
    }
  });

  worker.on('error', (error) => {
    if (
      error instanceof Error &&
      error.message.includes('max requests limit exceeded')
    ) {
      log.warn('Redis request limit exceeded — upgrade the Upstash plan');
      return;
    }
    // Other transient Upstash blips (failover/upgrade, severed connection,
    // Lua execution timed out) self-heal — warn instead of paging Sentry (API-58).
    if (isTransientRedisError(error)) {
      log.warn(
        `Transient Redis error (auto-recovering): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    logError('asset-thumbnail.workerError', error, {
      feature: 'asset-thumbnail',
    });
  });

  return worker;
}

export async function closeAssetThumbnailWorker(
  worker: Worker<AssetThumbnailJobPayload>
): Promise<void> {
  await worker.close();
  log.info('Worker closed');
}
