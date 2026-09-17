/**
 * Asset Transcode Processor
 *
 * Consumes 'asset-transcode' jobs. Downloads the source video, re-encodes it
 * to ≤1080p H.264 yuv420p with AAC stereo audio, uploads to S3, and writes
 * `transcodedBlobUrl` to the asset row. The original is kept untouched.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { asset, db, withSystemScope } from '@borradh-workspace/database';
import {
  ASSET_TRANSCODE_QUEUE,
  type AssetTranscodeJobPayload,
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
import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { downloadToFile } from './lib/download.js';

const execFileAsync = promisify(execFile);

let log: Logger;

const SYSTEM_FFMPEG = '/usr/bin/ffmpeg';

async function getFfmpegPath(): Promise<string> {
  if (fs.existsSync(SYSTEM_FFMPEG)) return SYSTEM_FFMPEG;
  // Dev-only fallback — see getFfprobePath in asset-probe-processor.
  let installer: { path: string };
  try {
    installer = await import('@ffmpeg-installer/ffmpeg');
  } catch (error) {
    throw new Error(
      `No ffmpeg available: ${SYSTEM_FFMPEG} does not exist and the dev-only @ffmpeg-installer fallback is not installed. Install ffmpeg.`,
      { cause: error }
    );
  }
  // pnpm can drop the execute bit on the installer binary → `spawn … EACCES`.
  // Restore it defensively (no-op when already +x). Mirrors getFfprobePath in
  // asset-probe-processor.
  try {
    fs.chmodSync(installer.path, 0o755);
  } catch {
    // Best-effort — if chmod fails, the original spawn error still surfaces.
  }
  return installer.path;
}

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

async function transcodeToH264(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const ffmpegPath = await getFfmpegPath();
  await execFileAsync(
    ffmpegPath,
    [
      '-y',
      '-i',
      inputPath,
      // Map only the primary video + audio streams; drop cover-art video,
      // secondary audio tracks, and data/subtitle streams that would
      // otherwise make ffmpeg fail on unidentifiable codecs.
      '-map',
      '0:v:0',
      '-map',
      '0:a:0?',
      '-dn',
      '-sn',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '23',
      '-vf',
      "scale='min(1920,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-ac',
      '2',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    { maxBuffer: 10 * 1024 * 1024 }
  );
}

async function processAssetTranscodeJob(
  job: Job<AssetTranscodeJobPayload>
): Promise<void> {
  const { assetId, organizationId, blobUrl } = job.data;
  const tempDir = path.join(
    os.tmpdir(),
    `asset-transcode-${assetId}-${Date.now()}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    log.info(`Transcoding asset ${assetId}`);

    const downloadUrl = await presignUrl(blobUrl);
    const inputPath = path.join(tempDir, 'source');
    const outputPath = path.join(tempDir, 'output.mp4');

    await downloadToFile(downloadUrl, inputPath);

    await transcodeToH264(inputPath, outputPath);

    const transcodedKey = `${organizationId}/videos/transcoded/${Date.now()}-${assetId}.mp4`;
    const orgBucket = getOrgAssetsBucket();

    // Streamed, not read into a Buffer. PR #561 traced a worker OOM to whole
    // videos held in memory: memory exhausted, BullMQ missed lock renewals, and
    // jobs stalled — presenting as a hang rather than an OOM. That PR converted
    // the download side and the remux upload; this upload was missed and still
    // buffered the entire transcoded file (~100 MB for a 4K source) per
    // concurrent job, on top of ffmpeg's own usage.
    //
    // S3 PutObject needs Content-Length up front for a stream body, so the size
    // is stat'd rather than inferred.
    const { size: outputSize } = fs.statSync(outputPath);

    await upload({
      bucket: orgBucket,
      key: transcodedKey,
      body: fs.createReadStream(outputPath),
      contentLength: outputSize,
      contentType: 'video/mp4',
    });

    const transcodedBlobUrl = isCdnEnabled()
      ? getPrivateCdnUrl(transcodedKey)
      : `https://${orgBucket}.s3.amazonaws.com/${transcodedKey}`;

    await withSystemScope(
      (conn) =>
        conn
          .update(asset)
          .set({
            transcodedBlobUrl,
            transcodeStatus: 'ready',
            transcodedAt: new Date(),
          })
          .where(eq(asset.id, assetId)),
      { db }
    );

    log.info(`Asset ${assetId} transcoded: ${transcodedBlobUrl}`);
  } catch (error) {
    logError('assets.transcodeAsset', error, {
      feature: 'assets',
      extra: { assetId },
    });
    try {
      await withSystemScope(
        (conn) =>
          conn
            .update(asset)
            .set({ transcodeStatus: 'failed', transcodedAt: new Date() })
            .where(eq(asset.id, assetId)),
        { db }
      );
    } catch (updateError) {
      logError('assets.transcodeAsset.markFailed', updateError, {
        feature: 'assets',
        extra: { assetId },
      });
    }
    throw error;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function createAssetTranscodeWorker(): Worker<AssetTranscodeJobPayload> {
  log = createLogger('asset-transcode');

  const redis = getRedis();

  log.info('Starting asset transcode worker...');

  const worker = new Worker<AssetTranscodeJobPayload>(
    ASSET_TRANSCODE_QUEUE,
    async (job) => {
      await processAssetTranscodeJob(job);
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: 1,
      lockDuration: 900_000, // 15 min per job — transcodes can be slow
      stalledInterval: 60_000,
    }
  );

  worker.on('completed', (job) => {
    log.info(`Job completed: ${job.id}`);
  });

  worker.on('failed', async (job, error) => {
    logError('asset-transcode.jobFailed', error, {
      feature: 'asset-transcode',
      extra: { jobId: job?.id, assetId: job?.data.assetId },
    });

    // PRD-40: dead-letter + alert on terminal failure. The processor flips the
    // asset's transcodeStatus to `failed`; this captures the job for replay so
    // a b-roll clip stuck un-transcoded is visible rather than silently lost.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: ASSET_TRANSCODE_QUEUE,
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
    logError('asset-transcode.workerError', error, {
      feature: 'asset-transcode',
    });
  });

  return worker;
}

export async function closeAssetTranscodeWorker(
  worker: Worker<AssetTranscodeJobPayload>
): Promise<void> {
  await worker.close();
  log.info('Worker closed');
}
