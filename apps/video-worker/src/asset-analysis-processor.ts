/**
 * Asset Analysis Processor
 *
 * Processes asset analysis jobs from the 'asset-analysis' queue.
 * Uses GPT-4 Vision to analyze video frames and generate:
 * - Descriptive tags
 * - Content type classification
 * - Service matching
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  asset,
  assetAnalysis,
  assetService,
  contentTypeToTagMap,
  db,
  withSystemScope,
} from '@borradh-workspace/database';
import type { AssetAnalysisResult } from '@borradh-workspace/database';
import {
  ASSET_ANALYSIS_QUEUE,
  type AssetAnalysisJobPayload,
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
  getPresignedDownloadUrl,
  parseS3Url,
} from '@borradh-workspace/storage';
import { upload } from '@borradh-workspace/storage';
import {
  RemuxError,
  extractKeyFramesWithTimestamps,
  getVideoMetadata,
  remuxToFaststartMp4,
  transcodeToFaststartMp4,
} from '@borradh-workspace/video-processing/ffmpeg';
import {
  EmptyVisionResponseError,
  type VisionModel,
  analyzeFrames,
  analyzeFramesWithSegments,
  initVisionApi,
  isVisionApiInitialized,
} from '@borradh-workspace/video-processing/vision';
import { type Job, UnrecoverableError, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import { downloadToFile } from './lib/download.js';

// Worker concurrency - lower than video rendering since Vision API has rate limits
const ANALYSIS_WORKER_CONCURRENCY = Number.parseInt(
  process.env.ASSET_ANALYSIS_CONCURRENCY || '2',
  10
);

// Minimum confidence threshold for auto-linking services
const MIN_SERVICE_CONFIDENCE = 0.6;

// Logger (initialized in createAssetAnalysisWorker, after initLogger in main)
let log: Logger;

// Number of frames to extract for analysis (with timestamps for segment detection)
const FRAMES_TO_EXTRACT = Number.parseInt(
  process.env.VISION_SEGMENT_FRAMES_COUNT || '10',
  10
);

/**
 * Presign an S3 URL if needed
 */
async function presignS3UrlIfNeeded(url: string): Promise<string> {
  if (url.includes('?')) {
    return url;
  }

  const s3Info = parseS3Url(url);
  if (!s3Info) {
    return url;
  }

  return getPresignedDownloadUrl({
    bucket: s3Info.bucket,
    key: s3Info.key,
    expiresIn: 3600,
  });
}

/**
 * Download a file from URL to a temporary path
 */
async function downloadToTemp(url: string, filename: string): Promise<string> {
  const tempDir = os.tmpdir();
  const tempPath = path.join(
    tempDir,
    `asset-analysis-${Date.now()}-${filename}`
  );

  // Stream to disk instead of buffering the whole video in memory — large
  // sources buffered via arrayBuffer() spiked worker memory and starved the
  // event loop enough to miss BullMQ lock renewals.
  await downloadToFile(url, tempPath);

  return tempPath;
}

/**
 * Clean up temporary files
 */
function cleanupTempFiles(...paths: string[]): void {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        if (fs.statSync(p).isDirectory()) {
          fs.rmSync(p, { recursive: true });
        } else {
          fs.unlinkSync(p);
        }
      }
    } catch {
      log.warn(`Failed to cleanup: ${p}`);
    }
  }
}

/**
 * Update analysis status in database
 */
async function updateAnalysisStatus(
  analysisId: string,
  status: 'queued' | 'processing' | 'completed' | 'failed',
  data?: {
    errorMessage?: string;
    analysisResult?: AssetAnalysisResult;
    // The column is `assetContentTypeEnum`, not free text — every caller already
    // passes `analysisResult.contentType`, so take that exact union.
    contentType?: AssetAnalysisResult['contentType'];
    startedAt?: Date;
    completedAt?: Date;
  }
): Promise<void> {
  await withSystemScope(
    (conn) =>
      conn
        .update(assetAnalysis)
        .set({
          status,
          ...data,
        })
        .where(eq(assetAnalysis.id, analysisId)),
    { db }
  );
}

/**
 * Get organization services for matching
 */
async function getOrganizationServices(
  organizationId: string
): Promise<{ id: string; name: string }[]> {
  const services = await withSystemScope(
    (conn) =>
      conn.query.organizationService.findMany({
        where: (s, { eq, and }) =>
          and(eq(s.organizationId, organizationId), eq(s.isActive, true)),
        columns: {
          id: true,
          name: true,
        },
      }),
    { db }
  );

  return services;
}

/**
 * Get organization business type
 */
async function getOrganizationBusinessType(
  organizationId: string
): Promise<string> {
  const org = await withSystemScope(
    (conn) =>
      conn.query.organization.findFirst({
        where: (o, { eq }) => eq(o.id, organizationId),
        columns: {
          businessType: true,
        },
      }),
    { db }
  );

  return org?.businessType || 'other';
}

/**
 * Create service links for high-confidence matches
 */
async function createServiceLinks(
  assetId: string,
  matchedServices: AssetAnalysisResult['matchedServices'],
  availableServices: { id: string; name: string }[]
): Promise<void> {
  // Map service names to IDs
  const serviceNameToId = new Map(
    availableServices.map((s) => [s.name.toLowerCase(), s.id])
  );

  const linksToCreate: Array<{
    assetId: string;
    serviceId: string;
    confidence: number;
    isAutoGenerated: boolean;
  }> = [];

  for (const match of matchedServices) {
    if (match.confidence < MIN_SERVICE_CONFIDENCE) {
      continue;
    }

    // Try to find matching service by name
    const serviceId =
      match.serviceId || serviceNameToId.get(match.serviceName.toLowerCase());

    if (serviceId) {
      linksToCreate.push({
        assetId,
        serviceId,
        confidence: match.confidence,
        isAutoGenerated: true,
      });
    }
  }

  if (linksToCreate.length > 0) {
    // Insert links, ignoring conflicts (service may already be linked)
    await withSystemScope(
      (conn) =>
        conn
          .insert(assetService)
          .values(linksToCreate)
          .onConflictDoNothing({
            target: [assetService.assetId, assetService.serviceId],
          }),
      { db }
    );

    log.info(`Created ${linksToCreate.length} service links`);
  }
}

/**
 * Update asset tags with suggested tags
 */
async function updateAssetTags(
  assetId: string,
  suggestedTags: string[]
): Promise<void> {
  // Get existing tags
  const existingAsset = await withSystemScope(
    (conn) =>
      conn.query.asset.findFirst({
        where: (a, { eq }) => eq(a.id, assetId),
        columns: { tags: true },
      }),
    { db }
  );

  const existingTags = existingAsset?.tags || [];

  // Merge and dedupe, keeping existing tags
  const normalizedNewTags = suggestedTags.map((t) => t.trim().toLowerCase());
  const mergedTags = [...new Set([...existingTags, ...normalizedNewTags])];

  // Limit to 20 tags
  const finalTags = mergedTags.slice(0, 20);

  await withSystemScope(
    (conn) =>
      conn.update(asset).set({ tags: finalTags }).where(eq(asset.id, assetId)),
    { db }
  );

  log.info(`Updated asset tags: ${finalTags.length} total tags`);
}

/**
 * Process an asset analysis job
 */
async function processAssetAnalysisJob(
  job: Job<AssetAnalysisJobPayload>
): Promise<void> {
  const { assetId, organizationId, analysisId } = job.data;

  log.info(`Processing asset: ${assetId}`);
  const startTime = Date.now();

  const tempFiles: string[] = [];

  try {
    // Mark as processing
    await updateAnalysisStatus(analysisId, 'processing', {
      startedAt: new Date(),
    });

    // Get asset details
    const assetRecord = await withSystemScope(
      (conn) =>
        conn.query.asset.findFirst({
          where: (a, { eq, and }) =>
            and(eq(a.id, assetId), eq(a.organizationId, organizationId)),
        }),
      { db }
    );

    if (!assetRecord) {
      throw new Error('Asset not found');
    }

    // Get organization services for matching
    const services = await getOrganizationServices(organizationId);
    const serviceNames = services.map((s) => s.name);

    // Get business type for context
    const businessType = await getOrganizationBusinessType(organizationId);

    const analysisContext = {
      organizationServices: serviceNames,
      businessType,
    };

    let analysisResult: Awaited<ReturnType<typeof analyzeFramesWithSegments>>;
    let frameCount: number;
    let videoDurationSec = 0;

    if (assetRecord.type === 'video') {
      // --- VIDEO PATH: download → remux if needed → extract frames → analyze with segments ---
      log.info('Downloading video...');
      const presignedUrl = await presignS3UrlIfNeeded(assetRecord.blobUrl);
      const rawExt = path
        .extname(new URL(assetRecord.blobUrl).pathname)
        .toLowerCase();
      const videoPath = await downloadToTemp(
        presignedUrl,
        `video${rawExt || '.mp4'}`
      );
      tempFiles.push(videoPath);

      // Remux .mov/.mts to faststart MP4 so Remotion Lambda can stream-seek.
      // iPhone .mov files have the moov atom at the end, forcing a full download
      // which blows Lambda's disk space. This remux is a fast copy (no re-encoding).
      const needsRemux = rawExt === '.mov' || rawExt === '.mts';
      let processPath = videoPath;
      if (needsRemux) {
        log.info(`Remuxing ${rawExt} to faststart MP4...`);
        const mp4Path = videoPath.replace(
          new RegExp(`${rawExt.replace('.', '\\.')}$`),
          '.mp4'
        );
        try {
          await remuxToFaststartMp4(videoPath, mp4Path);
          tempFiles.push(mp4Path);
          processPath = mp4Path;

          // Upload remuxed MP4 and update the asset's blobUrl so all
          // downstream consumers (render pipeline, previews) use the MP4.
          const s3Info = parseS3Url(assetRecord.blobUrl);
          if (s3Info) {
            const mp4Key = s3Info.key.replace(
              new RegExp(`${rawExt.replace('.', '\\.')}$`),
              '.mp4'
            );
            await upload({
              key: mp4Key,
              body: fs.createReadStream(mp4Path),
              contentLength: fs.statSync(mp4Path).size,
              contentType: 'video/mp4',
              bucket: s3Info.bucket,
            });
            // Rebuild URL using the same hostname pattern as the original
            const originalUrl = new URL(assetRecord.blobUrl);
            const newBlobUrl = `${originalUrl.protocol}//${originalUrl.host}/${mp4Key}`;
            await withSystemScope(
              (conn) =>
                conn
                  .update(asset)
                  .set({ blobUrl: newBlobUrl })
                  .where(eq(asset.id, assetId)),
              { db }
            );
            log.info(`Remuxed and updated blobUrl to MP4: ${mp4Key}`);
          }
        } catch (remuxError) {
          const remuxCode =
            remuxError instanceof RemuxError ? remuxError.code : 'UNKNOWN';
          // DISK_SPACE: retrying won't help if /tmp is full. Surface immediately
          //   via UnrecoverableError so BullMQ skips remaining attempts.
          // SYSTEM_ERROR: explicitly classified infra issue (rare today, reserved
          //   for future patterns). Re-throw normally so BullMQ retries.
          // Everything else (UNKNOWN, UNSUPPORTED_CODEC, CORRUPTED_INPUT): the
          //   source can't be stream-copied to MP4 (ENG-338). Fall back to a
          //   full re-encode so we still produce a faststart MP4 that Lambda can
          //   seek — keeping the original .mov as blobUrl strands the asset.
          logError('video-worker.assetAnalysis.remux', remuxError, {
            feature: 'video-worker',
            extra: {
              assetId,
              rawExt,
              videoPath,
              remuxErrorCode: remuxCode,
            },
          });

          if (remuxCode === 'DISK_SPACE') {
            throw new UnrecoverableError(
              `Remux aborted: ${remuxError instanceof Error ? remuxError.message : String(remuxError)}`
            );
          }
          if (remuxCode === 'SYSTEM_ERROR') {
            throw remuxError;
          }

          // CORRUPTED_INPUT can't be salvaged by re-encoding either; fall back
          // to the original file and let analysis proceed best-effort.
          if (remuxCode === 'CORRUPTED_INPUT') {
            log.warn(
              `Remux failed for ${rawExt} with ${remuxCode}, continuing with original file`
            );
          } else {
            try {
              log.info(
                `Remux not possible (${remuxCode}); re-encoding ${rawExt} to MP4...`
              );
              await transcodeToFaststartMp4(videoPath, mp4Path);
              tempFiles.push(mp4Path);
              processPath = mp4Path;

              const s3Info = parseS3Url(assetRecord.blobUrl);
              if (s3Info) {
                const mp4Key = s3Info.key.replace(
                  new RegExp(`${rawExt.replace('.', '\\.')}$`),
                  '.mp4'
                );
                await upload({
                  key: mp4Key,
                  body: fs.createReadStream(mp4Path),
                  contentLength: fs.statSync(mp4Path).size,
                  contentType: 'video/mp4',
                  bucket: s3Info.bucket,
                });
                const originalUrl = new URL(assetRecord.blobUrl);
                const newBlobUrl = `${originalUrl.protocol}//${originalUrl.host}/${mp4Key}`;
                await withSystemScope(
                  (conn) =>
                    conn
                      .update(asset)
                      .set({ blobUrl: newBlobUrl })
                      .where(eq(asset.id, assetId)),
                  { db }
                );
                log.info(`Re-encoded and updated blobUrl to MP4: ${mp4Key}`);
              }
            } catch (transcodeError) {
              const transcodeCode =
                transcodeError instanceof RemuxError
                  ? transcodeError.code
                  : 'UNKNOWN';
              logError(
                'video-worker.assetAnalysis.transcodeFallback',
                transcodeError,
                {
                  feature: 'video-worker',
                  extra: { assetId, rawExt, remuxErrorCode: remuxCode },
                }
              );
              if (transcodeCode === 'DISK_SPACE') {
                throw new UnrecoverableError(
                  `Transcode fallback aborted: ${transcodeError instanceof Error ? transcodeError.message : String(transcodeError)}`
                );
              }
              log.warn(
                `Transcode fallback failed (${transcodeCode}), continuing with original file`
              );
            }
          }
        }
      }

      const framesDir = path.join(os.tmpdir(), `frames-${Date.now()}`);
      fs.mkdirSync(framesDir, { recursive: true });
      tempFiles.push(framesDir);

      log.info('Getting video metadata...');
      const videoMetadata = await getVideoMetadata(processPath);
      videoDurationSec = videoMetadata.duration || 0;

      // Persist duration to asset table so resolveBRollAssets has correct source length
      if (videoDurationSec > 0) {
        await withSystemScope(
          (conn) =>
            conn
              .update(asset)
              .set({ duration: videoDurationSec })
              .where(eq(asset.id, assetId)),
          { db }
        );
      }

      log.info(`Extracting ${FRAMES_TO_EXTRACT} key frames with timestamps...`);
      const frames = await extractKeyFramesWithTimestamps(processPath, {
        count: FRAMES_TO_EXTRACT,
        outputDir: framesDir,
      });

      if (frames.length === 0) {
        throw new Error('Failed to extract any frames from video');
      }

      log.info(`Extracted ${frames.length} frames`);
      frameCount = frames.length;

      log.info('Analyzing frames with Vision API (with segment detection)...');
      analysisResult = await analyzeFramesWithSegments(
        frames,
        analysisContext,
        videoDurationSec
      );
    } else {
      // --- IMAGE PATH: download → analyze single image directly ---
      const ext = path.extname(assetRecord.blobUrl).split('?')[0] || '.jpg';
      log.info('Downloading image...');
      const presignedUrl = await presignS3UrlIfNeeded(assetRecord.blobUrl);
      const imagePath = await downloadToTemp(presignedUrl, `image${ext}`);
      tempFiles.push(imagePath);

      frameCount = 1;

      log.info('Analyzing image with Vision API...');
      const imageResult = await analyzeFrames(
        [imagePath],
        analysisContext,
        undefined,
        'image'
      );

      analysisResult = imageResult;
    }

    const processingTimeMs = Date.now() - startTime;

    // Build full analysis result (actionSegments flows through the spread)
    const fullResult: AssetAnalysisResult = {
      ...analysisResult,
      frameCount,
      modelUsed: 'gpt-4o',
      processingTimeMs,
      // Store video duration so resolveBRollAssets can use it as fallback
      ...(videoDurationSec > 0 ? { videoDurationSec } : {}),
    };

    // Log the tagging decision so the abstention rate is measurable. A prompt
    // that abstains on everything would look like a win (no more wrong links)
    // while quietly stripping every legitimate one — this is how we'd see it.
    log.info('Asset service identification', {
      assetId,
      organizationId,
      contentType: analysisResult.contentType,
      instrument: analysisResult.observation?.instrument ?? null,
      bodyArea: analysisResult.observation?.bodyArea ?? null,
      isRealFootage: analysisResult.observation?.isRealFootage ?? true,
      identifiedService:
        analysisResult.serviceIdentification?.serviceName ?? null,
      identificationConfidence:
        analysisResult.serviceIdentification?.confidence ?? null,
      // Abstention is a CORRECT outcome, not a failure — publishing the wrong
      // footage for a treatment costs more than publishing none.
      abstained: analysisResult.matchedServices.length === 0,
      linkedServiceCount: analysisResult.matchedServices.length,
      candidateServiceCount: services.length,
    });

    // Create service links for high-confidence matches
    await createServiceLinks(assetId, analysisResult.matchedServices, services);

    // Build tags from three dimensions:
    // 1. Content type tag — mapped from AI contentType enum
    // 2. Service names — from high-confidence matched services (kebab-cased)
    // 3. Client name — from asset record (if present)
    const contentTypeTag = contentTypeToTagMap[analysisResult.contentType];

    const tagsToAdd: string[] = [];

    // Always add content type tag
    if (contentTypeTag) {
      tagsToAdd.push(contentTypeTag);
    }

    // Add matched service names as tags so clips are filterable by service
    for (const match of analysisResult.matchedServices) {
      if (match.confidence >= MIN_SERVICE_CONFIDENCE) {
        const serviceTag = match.serviceName.toLowerCase().replace(/\s+/g, '-');
        tagsToAdd.push(serviceTag);
      }
    }

    // Add client name as tag if present on the asset
    if (assetRecord.clientName) {
      tagsToAdd.push(assetRecord.clientName.toLowerCase().replace(/\s+/g, '-'));
    }

    // Update asset tags with all dimensions
    await updateAssetTags(assetId, tagsToAdd);

    // Mark as completed
    await updateAnalysisStatus(analysisId, 'completed', {
      analysisResult: fullResult,
      contentType: analysisResult.contentType,
      completedAt: new Date(),
    });

    log.info(`Asset ${assetId} analysis completed`, {
      processingTimeMs,
      contentType: analysisResult.contentType,
      matchedServices: analysisResult.matchedServices.length,
      suggestedTags: analysisResult.suggestedTags,
    });
  } catch (error) {
    // The Vision API produced no usable content even after retries (model
    // refusal, content filter, or persistent truncation). Retrying the BullMQ
    // job won't help — the input is the problem — so mark the asset failed and
    // surface as UnrecoverableError to skip remaining attempts.
    const isEmptyVisionResponse = error instanceof EmptyVisionResponseError;

    logError('video-worker.assetAnalysis.processAsset', error, {
      feature: 'video-worker',
      extra: {
        jobId: job.id,
        assetId,
        organizationId,
        analysisId,
        emptyVisionResponse: isEmptyVisionResponse,
      },
    });

    await updateAnalysisStatus(analysisId, 'failed', {
      errorMessage: isEmptyVisionResponse
        ? 'We could not analyze this asset (the AI returned no result). Please try a different image or video.'
        : 'Analysis failed. Please try again.',
      completedAt: new Date(),
    });

    if (isEmptyVisionResponse) {
      throw new UnrecoverableError(
        error instanceof Error ? error.message : String(error)
      );
    }

    throw error;
  } finally {
    // Cleanup temp files
    cleanupTempFiles(...tempFiles);
  }
}

/**
 * Initialize the Vision API
 */
function initializeVisionApi(): void {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    log.warn(
      'OPENAI_API_KEY not set. Asset analysis will fail until this is configured.'
    );
    return;
  }

  if (!isVisionApiInitialized()) {
    initVisionApi({
      apiKey,
      model: (process.env.OPENAI_VISION_MODEL as VisionModel) || 'gpt-5.6-luna',
      verbose: process.env.NODE_ENV !== 'production',
    });
    log.info('Vision API initialized');
  }
}

/**
 * Create and return the asset analysis worker
 */
export function createAssetAnalysisWorker(): Worker<AssetAnalysisJobPayload> {
  // Initialize logger (rootLogger is ready after initLogger in main)
  log = createLogger('asset-analysis');

  // Initialize Vision API
  initializeVisionApi();

  // Get Redis connection
  const redis = getRedis();

  log.info(`Starting worker with concurrency: ${ANALYSIS_WORKER_CONCURRENCY}`);

  // Create worker
  const worker = new Worker<AssetAnalysisJobPayload>(
    ASSET_ANALYSIS_QUEUE,
    async (job) => {
      try {
        await processAssetAnalysisJob(job);
      } catch (error) {
        logError('video-worker.assetAnalysis.processJob', error, {
          feature: 'video-worker',
          extra: {
            jobId: job.id,
            assetId: job.data.assetId,
            organizationId: job.data.organizationId,
          },
        });
        throw error;
      }
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: ANALYSIS_WORKER_CONCURRENCY,
      lockDuration: 300000, // 5 minute lock (analysis can take a while)
      stalledInterval: 60000, // Check for stalled jobs every minute
    }
  );

  // Worker event handlers
  worker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });

  worker.on('active', (job) => {
    log.info(`Job ${job.id} started`);
  });

  worker.on('completed', (job) => {
    log.info(`Job ${job.id} completed`);
  });

  worker.on('failed', async (job, error) => {
    logError('video-worker.assetAnalysis.jobFailed', error, {
      feature: 'video-worker',
      extra: { jobId: job?.id, assetId: job?.data.assetId },
    });

    // PRD-40: dead-letter + alert on terminal failure. The processor already
    // flips the analysis row to `failed`; this captures the job for replay.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: ASSET_ANALYSIS_QUEUE,
        job,
        error,
        context: {
          assetId: job.data?.assetId,
          analysisId: job.data?.analysisId,
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
    logError('video-worker.assetAnalysis.workerError', error, {
      feature: 'video-worker',
    });
  });

  return worker;
}

/**
 * Close the asset analysis worker
 */
export async function closeAssetAnalysisWorker(
  worker: Worker<AssetAnalysisJobPayload>
): Promise<void> {
  await worker.close();
  log.info('Worker closed');
}
