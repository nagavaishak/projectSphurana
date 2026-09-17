/**
 * Asset Probe Processor
 *
 * Consumes 'asset-probe' jobs. Runs ffprobe on the source video and writes
 * codec / pixFmt / width / height / duration / bitrateKbps to the asset row.
 *
 * After probing, decides whether the asset needs transcoding and enqueues a
 * transcode job. This keeps the skip decision in one place.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { asset, db, withSystemScope } from '@borradh-workspace/database';
import {
  ASSET_PROBE_QUEUE,
  type AssetProbeJobPayload,
  type AssetTranscodeJobPayload,
  getAssetTranscodeQueue,
  shouldSkipTranscode,
} from '@borradh-workspace/features/assets';
import {
  isTerminalFailure,
  moveToDeadLetter,
  safeJobId,
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
} from '@borradh-workspace/storage';
import { type Job, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { downloadToFile, isMissingAssetError } from './lib/download.js';

const execFileAsync = promisify(execFile);

let log: Logger;

const SYSTEM_FFPROBE = '/usr/bin/ffprobe';

async function getFfprobePath(): Promise<string> {
  if (fs.existsSync(SYSTEM_FFPROBE)) return SYSTEM_FFPROBE;
  // Dev-only fallback: @ffprobe-installer is a devDependency, so it is absent
  // from the deployed image (which apt-installs ffmpeg at SYSTEM_FFPROBE).
  // Guarded so "no system binary AND no dev fallback" reports what is wrong
  // rather than a bare ERR_MODULE_NOT_FOUND.
  let installer: { path: string };
  try {
    installer = await import('@ffprobe-installer/ffprobe');
  } catch (error) {
    throw new Error(
      `No ffprobe available: ${SYSTEM_FFPROBE} does not exist and the dev-only @ffprobe-installer fallback is not installed. Install ffmpeg.`,
      { cause: error }
    );
  }
  // pnpm can install the @ffprobe-installer binary WITHOUT the execute bit,
  // which makes `spawn … ffprobe` fail with EACCES. Restore +x defensively
  // (no-op when already executable). The system ffprobe path above covers the
  // Linux worker image; this guards local/dev runs on macOS.
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

interface ProbeResult {
  codec: string | null;
  pixFmt: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  bitrateKbps: number | null;
}

async function runFfprobe(filePath: string): Promise<ProbeResult> {
  const ffprobePath = await getFfprobePath();
  const { stdout } = await execFileAsync(ffprobePath, [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath,
  ]);

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      pix_fmt?: string;
      width?: number;
      height?: number;
    }>;
    format?: { duration?: string; bit_rate?: string };
  };

  const videoStream = parsed.streams?.find((s) => s.codec_type === 'video');
  const durationStr = parsed.format?.duration;
  const bitRateStr = parsed.format?.bit_rate;

  return {
    codec: videoStream?.codec_name ?? null,
    pixFmt: videoStream?.pix_fmt ?? null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    duration: durationStr ? Number(durationStr) : null,
    bitrateKbps: bitRateStr ? Math.round(Number(bitRateStr) / 1000) : null,
  };
}

async function processAssetProbeJob(
  job: Job<AssetProbeJobPayload>
): Promise<void> {
  const { assetId, organizationId, blobUrl } = job.data;
  const tempDir = path.join(
    os.tmpdir(),
    `asset-probe-${assetId}-${Date.now()}`
  );

  try {
    fs.mkdirSync(tempDir, { recursive: true });
    log.info(`Probing asset ${assetId}`);

    const downloadUrl = await presignUrl(blobUrl);
    const tempPath = path.join(tempDir, 'source');
    await downloadToFile(downloadUrl, tempPath);

    const probe = await runFfprobe(tempPath);

    await withSystemScope(
      (conn) =>
        conn
          .update(asset)
          .set({
            codec: probe.codec,
            pixFmt: probe.pixFmt,
            width: probe.width,
            height: probe.height,
            duration: probe.duration,
            bitrateKbps: probe.bitrateKbps,
            probeStatus: 'ready',
            probedAt: new Date(),
          })
          .where(eq(asset.id, assetId)),
      { db }
    );

    log.info(
      `Probed ${assetId}: codec=${probe.codec} ${probe.width}x${probe.height} ${probe.bitrateKbps}kbps`
    );

    // Decide whether to skip or enqueue transcode.
    if (shouldSkipTranscode(probe)) {
      await withSystemScope(
        (conn) =>
          conn
            .update(asset)
            .set({ transcodeStatus: 'skipped', transcodedAt: new Date() })
            .where(eq(asset.id, assetId)),
        { db }
      );
      log.info(`Asset ${assetId} meets skip criteria — no transcode needed`);
      return;
    }

    await withSystemScope(
      (conn) =>
        conn
          .update(asset)
          .set({ transcodeStatus: 'pending' })
          .where(eq(asset.id, assetId)),
      { db }
    );

    try {
      const transcodeQueue = getAssetTranscodeQueue();
      await transcodeQueue.add(
        'transcode-asset',
        {
          assetId,
          organizationId,
          blobUrl,
        } satisfies AssetTranscodeJobPayload,
        { jobId: safeJobId('transcode', assetId, Date.now()) }
      );
    } catch (error) {
      logError('assets.probeAsset.enqueueTranscode', error, {
        feature: 'assets',
        extra: { assetId },
      });
    }
  } catch (error) {
    // A 404/403 means the source object is gone or inaccessible (deleted,
    // expired, or a smoke-test fixture that never existed). Retrying won't
    // help and it isn't a code defect — mark the asset failed and warn,
    // don't raise a Sentry error (ENG-250).
    const missingAsset = isMissingAssetError(error);
    if (missingAsset) {
      log.warn(
        `Asset ${assetId} source unavailable — skipping probe: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } else {
      logError('assets.probeAsset', error, {
        feature: 'assets',
        extra: { assetId },
      });
    }
    try {
      await withSystemScope(
        (conn) =>
          conn
            .update(asset)
            // Keep the two pipeline states consistent. Leaving transcode in
            // `pending` after ffprobe has terminally failed causes the render
            // gate to tell users to wait forever instead of letting them
            // replace/re-upload the unusable clip.
            .set({
              probeStatus: 'failed',
              transcodeStatus: 'failed',
              probedAt: new Date(),
            })
            .where(eq(asset.id, assetId)),
        { db }
      );
    } catch (updateError) {
      logError('assets.probeAsset.markFailed', updateError, {
        feature: 'assets',
        extra: { assetId },
      });
    }
    // Swallow missing-asset failures so BullMQ doesn't retry+fail (which
    // would re-raise via the worker 'failed' handler). Transient/real
    // errors still throw so BullMQ retries them.
    if (!missingAsset) throw error;
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

export function createAssetProbeWorker(): Worker<AssetProbeJobPayload> {
  log = createLogger('asset-probe');

  const redis = getRedis();

  log.info('Starting asset probe worker...');

  const worker = new Worker<AssetProbeJobPayload>(
    ASSET_PROBE_QUEUE,
    async (job) => {
      await processAssetProbeJob(job);
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: 2,
      lockDuration: 300_000,
      stalledInterval: 60_000,
    }
  );

  worker.on('completed', (job) => {
    log.info(`Job completed: ${job.id}`);
  });

  worker.on('failed', async (job, error) => {
    logError('asset-probe.jobFailed', error, {
      feature: 'asset-probe',
      extra: { jobId: job?.id, assetId: job?.data.assetId },
    });

    // PRD-40: dead-letter + alert on terminal failure. The processor flips the
    // asset's probeStatus to `failed`; this captures the job for replay.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: ASSET_PROBE_QUEUE,
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
    // Upstash (and other Redis providers) return this when the daily request
    // quota is exhausted. It is an infrastructure/billing signal, not a code
    // bug — suppress the Sentry flood and emit a single warning instead.
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
    logError('asset-probe.workerError', error, { feature: 'asset-probe' });
  });

  return worker;
}

export async function closeAssetProbeWorker(
  worker: Worker<AssetProbeJobPayload>
): Promise<void> {
  await worker.close();
  log.info('Worker closed');
}
