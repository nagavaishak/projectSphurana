/**
 * Video Worker
 *
 * @deploy 2026-03-17
 *
 * BullMQ worker that processes video rendering jobs.
 *
 * Consumes jobs from the 'video-render' queue and uses
 * Remotion Lambda for serverless video rendering.
 *
 * For beauty clinic before/after videos:
 * 1. Extracts audio from talking head
 * 2. Transcribes audio using Whisper
 * 3. Builds TikTok-style caption pages
 * 4. Schedules b-roll clips (before, procedure, after)
 * 5. Renders video with Remotion Lambda
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
// BOOT GATE. `createEnv()` validates at import time, so a missing
// REMOTION_FUNCTION_NAME / REMOTION_SERVE_URL throws HERE — before a single
// BullMQ consumer is registered. Previously this worker imported NO env
// validation at all (32 raw `process.env` reads): it booted green, passed its
// health check, drained the queue and failed every job. The deploy workflow's
// claim that "the deploy IS the env validation" was true for the API (which
// imports `apiEnv`) and false for the worker.
import {
  initAIClient,
  isAIClientInitialized,
  visionCompletion,
} from '@borradh-workspace/ai';
import {
  type VideoProcessingStage,
  asset,
  assetAnalysis,
  db,
  isTransientDbError,
  organization,
  withDbRetry,
  withSystemScope,
} from '@borradh-workspace/database';
import { video } from '@borradh-workspace/database/schema';
import type {
  BRollClipConfig,
  VideoDraftConfig,
} from '@borradh-workspace/database/schema';
import { observabilityEnv } from '@borradh-workspace/env/observability';
import { videoProcessingEnv } from '@borradh-workspace/env/video-processing';
import { queueClaireWhatsappOutbound } from '@borradh-workspace/features/assistant';
import { settleBatchForAsset } from '@borradh-workspace/features/content-batches';
import { recordProvenanceSafe } from '@borradh-workspace/features/content-provenance';
import {
  type VideoRenderJobPayload,
  parseJobData,
  videoRenderJob,
  videoRenderQueue,
} from '@borradh-workspace/features/jobs';
import { getFreshDownloadUrl } from '@borradh-workspace/features/meta-ads';
import { sendPushNotification } from '@borradh-workspace/features/notifications';
import {
  getTemplateById,
  moveToDeadLetterQueue,
} from '@borradh-workspace/features/videos';
import {
  createRedisFakeStore,
  installMetaContractInterceptor,
} from '@borradh-workspace/integrations/meta-contract';
import {
  type Logger,
  applyTcpResilienceTuning,
  createLogger,
  flushLogs,
  flush as flushSentry,
  initLogger,
  initPostHog,
  initSentry,
  isPostHogInitialized,
  logError,
  logWarning,
  shutdown as shutdownPostHog,
  startPostHogHeartbeat,
  startTelemetryCanary,
  trackOrgEvent,
} from '@borradh-workspace/observability';
import {
  disconnect,
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import {
  copyFromUrl,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getPublicAssetsBucket,
  parseCdnUrl,
  parseS3Url,
  upload,
} from '@borradh-workspace/storage';
import { getPrivateCdnUrl, isCdnEnabled } from '@borradh-workspace/storage';
import {
  type BRollClip,
  scheduleBRollClips,
  scheduledClipsToScenes,
} from '@borradh-workspace/video-processing/b-roll';
import {
  alignEditedCaptions,
  buildCaptionPages,
} from '@borradh-workspace/video-processing/captions';
import {
  addFastStart,
  extractAudioAsWav,
  extractKeyFrames,
  getVideoMetadata,
  initFFmpeg,
} from '@borradh-workspace/video-processing/ffmpeg';
import {
  initRemotionLambda,
  renderAndWait,
  renderAndWaitV2,
} from '@borradh-workspace/video-processing/remotion-lambda';
import type { RenderProgress } from '@borradh-workspace/video-processing/remotion-lambda';
import {
  generateTts,
  initTts,
  isTtsReady,
} from '@borradh-workspace/video-processing/tts';
import type { KokoroVoice } from '@borradh-workspace/video-processing/tts';
import type { ActionSegment } from '@borradh-workspace/video-processing/vision';
import {
  createConfigFromEnv,
  getTranscriptionMode,
  initTranscription,
  transcribe,
} from '@borradh-workspace/video-processing/whisper';
import { type Job, type JobType, Queue, Worker } from 'bullmq';
import { inArray } from 'drizzle-orm';
import { eq } from 'drizzle-orm';
import {
  closeAssetAnalysisWorker,
  createAssetAnalysisWorker,
} from './asset-analysis-processor.js';
import {
  closeAssetProbeWorker,
  createAssetProbeWorker,
} from './asset-probe-processor.js';
import {
  closeAssetThumbnailWorker,
  createAssetThumbnailWorker,
} from './asset-thumbnail-processor.js';
import {
  closeAssetTranscodeWorker,
  createAssetTranscodeWorker,
} from './asset-transcode-processor.js';
import {
  closeContentBatchGenerateWorker,
  createContentBatchGenerateWorker,
} from './content-batch-generate-processor.js';
import { scheduleCopyDrivenBRoll } from './copy-driven-broll.js';
import {
  closeGraphicGenerateWorker,
  createGraphicGenerateWorker,
} from './graphic-generate-processor.js';
import { startHealthServer } from './health-server.js';
import { downloadToFile } from './lib/download.js';
import {
  closeMetaCampaignDuplicateWorker,
  createMetaCampaignDuplicateWorker,
} from './meta-campaign-duplicate-processor.js';
import {
  closeMetaSyncWorker,
  createMetaSyncWorker,
} from './meta-sync-processor.js';
import {
  closeMicrositeDomainWorker,
  createMicrositeDomainWorker,
} from './microsite-domain-processor.js';
import { resolveMusicUrl } from './music-url.js';
import { compileRenderDoc } from './render-doc-compiler.js';
import { summariseRenderSchedule } from './render-provenance.js';
import {
  closeStockMatchWorker,
  createStockMatchWorker,
} from './stock-match-processor.js';

// Retry transient connection errors on worker status writes. A rendered video/
// graphic must not be stranded (and the worker must not crash-loop) just
// because the "mark ready/failed" write hit a cold/suspended Neon compute
// (CONNECT_TIMEOUT) — withDbRetry reconnects on a fresh connection. Tight
// backoff: a cold Neon wakes on the first attempt, so the retry lands quickly.
const WORKER_DB_WRITE_RETRY = {
  retries: 5,
  minDelayMs: 300,
  maxDelayMs: 3000,
} as const;

// Queue name for video rendering jobs — DERIVED from the one declaration.
const VIDEO_RENDER_QUEUE = videoRenderQueue.name;

// Environment variables — validated at import (see videoProcessingEnv above).
// These are `.min(1)` / `.url()` REQUIRED in the schema, so they cannot be ''.
const REMOTION_FUNCTION_NAME = videoProcessingEnv.REMOTION_FUNCTION_NAME;
const REMOTION_SERVE_URL = videoProcessingEnv.REMOTION_SERVE_URL;
const REMOTION_AWS_REGION = videoProcessingEnv.REMOTION_AWS_REGION;

/**
 * Fetch ECS task role credentials and set them as env vars for Remotion.
 * Remotion's SDK requires explicit AWS_ACCESS_KEY_ID / REMOTION_AWS_ACCESS_KEY_ID
 * env vars — it doesn't use the standard credential provider chain.
 * In ECS Fargate, temporary credentials are available via the container metadata endpoint.
 */
async function loadRemotionCredentials(log: Logger): Promise<void> {
  // In local dev, credentials come from AWS profile / env vars already set
  const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  if (!relativeUri) {
    log.info(
      'Not running in ECS — skipping container credential fetch for Remotion'
    );
    return;
  }

  try {
    const response = await fetch(`http://169.254.170.2${relativeUri}`);
    if (!response.ok) {
      throw new Error(
        `ECS credential endpoint returned ${response.status} ${response.statusText}`
      );
    }
    const creds = (await response.json()) as {
      AccessKeyId: string;
      SecretAccessKey: string;
      Token: string;
    };
    if (!creds.AccessKeyId || !creds.SecretAccessKey || !creds.Token) {
      throw new Error('ECS credential response missing required fields');
    }
    process.env.REMOTION_AWS_ACCESS_KEY_ID = creds.AccessKeyId;
    process.env.REMOTION_AWS_SECRET_ACCESS_KEY = creds.SecretAccessKey;
    process.env.REMOTION_AWS_SESSION_TOKEN = creds.Token;
    log.info('Loaded ECS task role credentials for Remotion');
  } catch (error) {
    // Rethrow: rendering with stale/absent Remotion credentials fails opaquely
    // on Lambda. Surfacing here lets the job fail fast and retry (or the worker
    // exit loud at boot) instead of silently rendering against bad creds.
    logError('video-worker.loadEcsCredentials', error, {
      feature: 'video-worker',
    });
    throw error instanceof Error
      ? error
      : new Error('Failed to load ECS task role credentials for Remotion');
  }
}

// Worker concurrency - 1 for local dev (resource-intensive), 2 for production
// Reduced from 3→2 to give ~1GB per job (2GB container) and prevent OOM SIGKILLs
const VIDEO_WORKER_CONCURRENCY =
  videoProcessingEnv.VIDEO_WORKER_CONCURRENCY ??
  (process.env.NODE_ENV === 'production' ? 2 : 1);

// Default FPS for video rendering
const DEFAULT_FPS = 30;

const VIDEO_QUEUE_WARN_WAITING_DEPTH = parsePositiveIntEnv(
  'VIDEO_QUEUE_WARN_WAITING_DEPTH',
  25
);
const VIDEO_QUEUE_WARN_OLDEST_READY_JOB_AGE_MS = parsePositiveIntEnv(
  'VIDEO_QUEUE_WARN_OLDEST_READY_JOB_AGE_MS',
  30 * 60 * 1000
);
const VIDEO_QUEUE_WARN_ACTIVE_JOB_AGE_MS = parsePositiveIntEnv(
  'VIDEO_QUEUE_WARN_ACTIVE_JOB_AGE_MS',
  90 * 60 * 1000
);

// Logger instance (initialized in main())
let log: Logger;

function parsePositiveIntEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Timing instrumentation for bottleneck analysis
 */
interface ProcessingTimings {
  jobStarted: number;
  downloadStart?: number;
  downloadEnd?: number;
  generateVoiceoverStart?: number;
  generateVoiceoverEnd?: number;
  analyzeStart?: number;
  analyzeEnd?: number;
  extractAudioStart?: number;
  extractAudioEnd?: number;
  transcribeStart?: number;
  transcribeEnd?: number;
  buildCaptionsStart?: number;
  buildCaptionsEnd?: number;
  resolveAssetsStart?: number;
  resolveAssetsEnd?: number;
  scheduleBRollStart?: number;
  scheduleBRollEnd?: number;
  buildConfigStart?: number;
  buildConfigEnd?: number;
  renderStart?: number;
  renderEnd?: number;
  jobCompleted?: number;
}

function logTimings(videoId: string, timings: ProcessingTimings): void {
  const calculateDuration = (start?: number, end?: number): number | null => {
    if (start && end) return end - start;
    return null;
  };

  const report = {
    videoId,
    totalDurationMs: timings.jobCompleted
      ? timings.jobCompleted - timings.jobStarted
      : null,
    stages: {
      download: calculateDuration(timings.downloadStart, timings.downloadEnd),
      generateVoiceover: calculateDuration(
        timings.generateVoiceoverStart,
        timings.generateVoiceoverEnd
      ),
      analyze: calculateDuration(timings.analyzeStart, timings.analyzeEnd),
      extractAudio: calculateDuration(
        timings.extractAudioStart,
        timings.extractAudioEnd
      ),
      transcribe: calculateDuration(
        timings.transcribeStart,
        timings.transcribeEnd
      ),
      buildCaptions: calculateDuration(
        timings.buildCaptionsStart,
        timings.buildCaptionsEnd
      ),
      resolveAssets: calculateDuration(
        timings.resolveAssetsStart,
        timings.resolveAssetsEnd
      ),
      scheduleBRoll: calculateDuration(
        timings.scheduleBRollStart,
        timings.scheduleBRollEnd
      ),
      buildConfig: calculateDuration(
        timings.buildConfigStart,
        timings.buildConfigEnd
      ),
      render: calculateDuration(timings.renderStart, timings.renderEnd),
    },
  };

  // Identify bottleneck
  const stages = report.stages as Record<string, number | null>;
  let bottleneck = { stage: '', duration: 0 };
  for (const [stage, duration] of Object.entries(stages)) {
    if (duration && duration > bottleneck.duration) {
      bottleneck = { stage, duration };
    }
  }

  // Log structured timing data for BetterStack queries
  log.info('Video processing timing report', {
    type: 'video_processing_timing',
    ...report,
    bottleneck: bottleneck.stage,
    bottleneckDurationMs: bottleneck.duration,
  });
}

/**
 * Presign an S3 URL if it's a raw S3 URL without query params.
 * Returns the original URL if it's already signed or not an S3 URL.
 */
async function presignS3UrlIfNeeded(url: string): Promise<string> {
  // Already has query params (likely presigned)
  if (url.includes('?')) {
    return url;
  }

  const s3Info = parseS3Url(url);
  if (s3Info) {
    return getPresignedDownloadUrl({
      bucket: s3Info.bucket,
      key: s3Info.key,
      expiresIn: 3600, // 1 hour
    });
  }

  // Check if it's a CDN URL — extract the key and presign from the org-assets bucket
  if (isCdnEnabled()) {
    // Resolve scope from the CDN path: `/public/...` is served from the PUBLIC
    // bucket with the prefix stripped. Defaulting everything to the org bucket
    // sent every stock-footage render to a key that does not exist.
    const loc = parseCdnUrl(url);
    if (loc) {
      return getPresignedDownloadUrl({
        bucket:
          loc.scope === 'public'
            ? getPublicAssetsBucket()
            : getOrgAssetsBucket(),
        key: loc.key,
        expiresIn: 3600,
      });
    }
  }

  // Not an S3 or CDN URL, return as-is
  return url;
}

/**
 * Job payload from the queue-video-export service.
 *
 * This is now the ONE declaration (`packages/features/src/jobs/definitions/
 * video-render.job.ts`), not a fourth hand-kept copy of it. The worker's old
 * private interface was missing `theme` and `synthesisOverrides` entirely, so
 * TypeScript could not have caught a producer that dropped them — and one did.
 */
type VideoRenderJob = VideoRenderJobPayload;

/**
 * Full VideoConfig for Remotion Lambda
 */
interface VideoConfig {
  scenes: Array<{
    id: string;
    type: 'talking-head' | 'b-roll';
    clipUrl: string;
    trimStart: number;
    trimEnd: number;
    startFrame: number;
    durationInFrames: number;
    transition?: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'wipe';
    bRollType?: 'before' | 'after' | 'procedure';
  }>;
  captionPages: Array<{
    id: string;
    words: Array<{
      text: string;
      startMs: number;
      endMs: number;
    }>;
    startFrame: number;
    endFrame: number;
  }>;
  tikTokCaptionStyle: {
    position: 'top' | 'center' | 'bottom';
    fontFamily: string;
    fontSize: number;
    color: string;
    highlightColor: string;
    backgroundColor: string;
    showBackground: boolean;
    strokeWidth: number;
    strokeColor: string;
  };
  music?: {
    trackId: string;
    url: string;
    volume: number;
  };
  outroLayout?: {
    layout: 'offer' | 'location' | 'tagline';
    logoUrl?: string;
    businessName: string;
    tagline?: string;
    primaryColor: string;
    secondaryColor: string;
    backgroundColor?: string;
    address?: string;
    ctaText?: string;
    offerMainText?: string;
    offerSubtext?: string;
    durationInFrames: number;
  };
  /** AI-generated narration audio (used when narrationType is 'ai_voiceover') */
  narrationAudio?: {
    url: string;
    volume?: number;
  };
  /** Text frames for text_only narration mode (no voice, just text on screen) */
  textFrames?: Array<{
    id: string;
    text: string;
    startFrame: number;
    durationInFrames: number;
    style?: 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';
  }>;
  /** Educational video config - progressive stacking layout */
  educationalConfig?: {
    questionText: string;
    items: string[];
    ctaText: string;
    primaryColor: string;
    bpm?: number;
    beatsPerItem?: number;
  };
  /** Offer card overlay for promotion videos */
  offerCard?: Record<string, unknown>;
  /** Organic templates (text-on-b-roll, no narration) — at most one populated */
  captionTease?: {
    headline: string;
    emphasis?: string;
    emoji?: string;
    caption: string;
    charsPerSecond?: number;
  };
  fadeBenefits?: {
    lines: string[];
    secondsPerLine?: number;
  };
  aestheticLine?: {
    text: string;
  };
  numberedList?: {
    title: string;
    items: string[];
    /** Brand accent — matches remotion's canonical config for this block. */
    primaryColor?: string;
  };
  insOuts?: {
    title: string;
    insLabel?: string;
    insItems: string[];
    outsLabel?: string;
    outsItems: string[];
    /** Brand accent — matches remotion's canonical config for this block. */
    primaryColor?: string;
  };
  questionCta?: {
    question: string;
    ctaText: string;
    /** Brand accent — matches remotion's canonical config for this block. */
    primaryColor?: string;
  };
  improves?: {
    serviceName: string;
    improvesLabel?: string;
    items: string[];
    ctaText: string;
  };
  stepTimer?: {
    title: string;
    steps: Array<{ label: string; duration: string }>;
    primaryColor?: string;
    secondaryColor?: string;
  };
  timeProgress?: {
    startLabel: string;
    endLabel: string;
    caption: string;
    primaryColor?: string;
    businessName?: string;
  };
  poll?: {
    question: string;
    likeLabel: string;
    commentLabel: string;
    shareLabel?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  mythFact?: {
    seriesTitle?: string;
    pairs: Array<{ myth: string; fact: string }>;
    ctaText?: string;
  };
  versus?: {
    treatmentA: string;
    treatmentB: string;
    rounds: Array<{ label: string; aValue: string; bValue: string }>;
    verdict: string;
    primaryColor?: string;
  };
  priceReveal?: {
    hook: string;
    items: Array<{ name: string; price: string }>;
    totalPrice: string;
    valueLine?: string;
    primaryColor?: string;
  };
  clientQuestion?: {
    question: string;
    asker: string;
    answers: string[];
    ctaText?: string;
  };
  comeWithMe?: {
    title: string;
    seriesChip?: string;
    steps: string[];
    closingCta: string;
  };
  /** Template variation ID */
  variationId?: string;
  /** Text interstitial overlays (e.g., "CLIENT RESULTS COMING NOW") */
  textInterstitials?: Array<{
    text: string;
    startFrame: number;
    durationInFrames: number;
    verticalPosition?: number;
    fontSize?: number;
    soundEffectUrl?: string;
  }>;
  /** Full-screen reveal overlays (e.g., cinematic after photo with Ken Burns) */
  fullScreenReveals?: Array<{
    src: string;
    mediaType: 'image' | 'video';
    startFrame: number;
    durationInFrames: number;
    trimStart?: number;
    zoomRange?: [number, number];
    transition?: 'none' | 'fade' | 'slide-left' | 'slide-right' | 'wipe';
    transitionDurationFrames?: number;
    label?: string;
    labelPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
    soundEffectUrl?: string;
    soundEffectVolume?: number;
  }>;
  /** PiP overlays */
  pipOverlays?: Array<Record<string, unknown>>;
  orientation: 'portrait' | 'landscape' | 'square';
  fps: number;
  durationInFrames: number;
}

/**
 * Validate that a URL is safe to fetch (SSRF prevention).
 * Only allows HTTPS URLs from known trusted domains.
 */
function assertSafeDownloadUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `Only HTTPS URLs are allowed for download, got: ${parsed.protocol}`
    );
  }
  const allowedSuffixes = [
    '.amazonaws.com',
    '.borradh.io',
    '.mux.com',
    '.cloudfront.net',
  ];
  if (!allowedSuffixes.some((suffix) => parsed.hostname.endsWith(suffix))) {
    throw new Error(`URL hostname not in allowlist: ${parsed.hostname}`);
  }
}

/**
 * Download a file from URL to a temporary path
 */
async function downloadToTemp(url: string, filename: string): Promise<string> {
  assertSafeDownloadUrl(url);

  const safeName = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  const tempDir = os.tmpdir();
  const tempPath = path.join(tempDir, `video-worker-${Date.now()}-${safeName}`);

  // Stream to disk instead of buffering the whole file in memory — large
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
        fs.unlinkSync(p);
      }
    } catch {
      log?.warn(`Failed to cleanup: ${p}`);
    }
  }
}

/**
 * Get organization details for outro layout.
 *
 * The brand columns are NULLABLE in `organization` and this returns the row
 * verbatim, so the declared shape has to say so — the old non-null version was
 * a promise the query could not keep. Every read site already writes
 * `org?.x || <default>`, so the honest type changes no behaviour.
 */
async function getOrganizationDetails(organizationId: string): Promise<{
  name: string;
  logo: string | null;
  outroStyle: 'offer' | 'location' | 'tagline' | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  backgroundColor: string | null;
  tagline: string | null;
  address: string | null;
} | null> {
  const result = await withSystemScope(
    (conn) =>
      conn.query.organization.findFirst({
        where: eq(organization.id, organizationId),
        columns: {
          name: true,
          logo: true,
          outroStyle: true,
          primaryColor: true,
          secondaryColor: true,
          backgroundColor: true,
          tagline: true,
          address: true,
        },
      }),
    { db }
  );
  return result || null;
}

/**
 * Resolve b-roll asset URLs and durations from the database
 * Takes asset IDs from draftConfig and returns full asset info
 * Presigns S3 URLs so Remotion Lambda can access them
 */

/**
 * Footage-aware accent: ask the vision model to pick ONE overlay accent hex
 * that complements the actual b-roll (from its thumbnail). Best-effort — any
 * failure returns null and the layers fall back to brand colour, then the
 * curated reel palette. One low-detail vision call per render.
 */
async function deriveFootageAccent(
  thumbnailUrl: string,
  log: Logger
): Promise<{ accent: string; deep: string } | null> {
  try {
    if (!isAIClientInitialized()) {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return null;
      initAIClient({ apiKey });
    }
    const presigned = await presignS3UrlIfNeeded(thumbnailUrl);
    const result = await visionCompletion(
      'Design a two-colour overlay scheme for text chips/pills/badges on this video frame (a beauty/aesthetics reel). Sample the frame — do not ignore it. Return: (1) "accent" — a soft-editorial fill colour that complements the footage (tonal or gently complementary, no neon, no pure primaries), light-to-mid tone; (2) "deep" — a DARK companion of the same hue family (luminance clearly below mid-grey) that stays fully legible as SMALL text on warm off-white chips. Respond with ONLY JSON: {"accent":"#RRGGBB","deep":"#RRGGBB"}.',
      [{ url: presigned }],
      {
        systemMessage:
          'You are a colour director for premium beauty-clinic Instagram reels. You respond with compact JSON containing hex colours and nothing else.',
        detail: 'low',
        maxTokens: 60,
      }
    );
    const hexes = result.content?.match(/#[0-9a-fA-F]{6}/g) ?? [];
    // Destructure and test the element itself: a `.length >= 1` check does not
    // narrow an index access under noUncheckedIndexedAccess.
    const [accent, second] = hexes;
    if (accent) {
      const deep = second ?? accent;
      log.info(`Footage scheme derived: accent=${accent} deep=${deep}`);
      return { accent, deep };
    }
    return null;
  } catch (error) {
    log.warn(
      `Footage accent derivation failed (falling back to brand/palette): ${error instanceof Error ? error.message : String(error)}`
    );
    return null;
  }
}

async function resolveBRollAssets(assetIds: string[]): Promise<
  Map<
    string,
    {
      url: string;
      durationSec: number;
      mediaType: 'video' | 'image';
      actionSegments?: ActionSegment[];
      thumbnailUrl?: string | null;
    }
  >
> {
  if (assetIds.length === 0) {
    return new Map();
  }

  const assets = await withSystemScope(
    (conn) =>
      conn.query.asset.findMany({
        where: inArray(asset.id, assetIds),
        columns: {
          id: true,
          blobUrl: true,
          transcodedBlobUrl: true,
          duration: true,
          type: true,
          thumbnailUrl: true,
        },
      }),
    { db }
  );

  // Query completed analysis data for action segments
  const analyses = await withSystemScope(
    (conn) =>
      conn.query.assetAnalysis.findMany({
        where: inArray(assetAnalysis.assetId, assetIds),
        columns: {
          assetId: true,
          status: true,
          analysisResult: true,
        },
      }),
    { db }
  );

  // Build analysis map keyed by assetId (segments + duration from analysis)
  const analysisMap = new Map<
    string,
    { segments?: ActionSegment[]; durationSec?: number }
  >();
  for (const analysis of analyses) {
    if (analysis.status === 'completed' && analysis.analysisResult) {
      const result = analysis.analysisResult;
      const segments = result.actionSegments as ActionSegment[] | undefined;

      // Extract duration: prefer explicit videoDurationSec, fallback to max endSec from segments
      let analysisDuration = (result as { videoDurationSec?: number })
        .videoDurationSec;
      if (!analysisDuration && segments && segments.length > 0) {
        analysisDuration = Math.max(...segments.map((s) => s.endSec));
      }

      analysisMap.set(analysis.assetId, {
        segments,
        durationSec: analysisDuration,
      });
    }
  }

  const assetMap = new Map<
    string,
    {
      url: string;
      durationSec: number;
      mediaType: 'video' | 'image';
      actionSegments?: ActionSegment[];
      // Declared by this function's return type and read by the footage-scheme
      // derivation; omitting it here made the assignment below excess-property.
      thumbnailUrl?: string | null;
    }
  >();
  for (const a of assets) {
    // Prefer the transcoded (≤1080p H.264) URL for b-roll so Remotion Lambda
    // chunks don't OOM trying to decode 4K/HEVC source files. Falls back to
    // the original blobUrl for assets that haven't been transcoded yet.
    const sourceUrl = a.transcodedBlobUrl ?? a.blobUrl;
    const presignedUrl = await presignS3UrlIfNeeded(sourceUrl);
    const isImage = a.type === 'image';
    const analysisData = analysisMap.get(a.id);
    assetMap.set(a.id, {
      url: presignedUrl,
      thumbnailUrl: a.thumbnailUrl,
      // Images have no source duration — use 5s so the scheduler can allocate time.
      // For videos: prefer asset.duration, then analysis-derived duration, then 10s fallback.
      durationSec: isImage ? 5 : a.duration || analysisData?.durationSec || 10,
      mediaType: a.type as 'video' | 'image',
      actionSegments: analysisData?.segments,
    });
  }

  return assetMap;
}

/**
 * Build full VideoConfig from draft config
 * This includes transcription, caption generation, and b-roll scheduling.
 * Branches based on narrationType:
 * - 'recorded' (default): Downloads talking head, extracts audio, transcribes
 * - 'ai_voiceover': Generates TTS audio from script, transcribes TTS for captions
 */
async function buildVideoConfig(
  draftConfig: VideoDraftConfig,
  organizationId: string,
  videoId: string,
  onProgress?: (stage: string, progress: number) => void,
  timings?: ProcessingTimings,
  templateId?: string,
  variationId?: string
): Promise<VideoConfig> {
  const fps = DEFAULT_FPS;
  const tempFiles: string[] = [];

  // Pre-flight validation: catch broken configs before expensive work
  if (!draftConfig.narrationType) {
    throw new Error(
      `Video ${videoId}: narrationType is not set. Cannot determine whether to use recorded talking head, AI voiceover, or text_only.`
    );
  }

  const isAiVoiceover = draftConfig.narrationType === 'ai_voiceover';
  const isTextOnly = draftConfig.narrationType === 'text_only';
  const isEducational = variationId?.startsWith('educational-') ?? false;
  const isCaptionTease = variationId === 'caption-tease-1';
  // highlight-caption reuses the fade-benefits path (sequential lines, one per
  // clip); the config's `highlight` flag switches the layer to block styling.
  const isFadeBenefits =
    variationId === 'fade-benefits-1' || variationId === 'highlight-caption-1';
  const isAestheticLine = variationId === 'aesthetic-line-1';
  const isNumberedList = variationId === 'numbered-list-1';
  const isInsOuts = variationId === 'ins-outs-1';
  // curiosity-hook reuses the question-cta render path (top claim + bottom CTA).
  const isQuestionCta =
    variationId === 'question-cta-1' || variationId === 'curiosity-hook-1';
  const isImproves = variationId === 'improves-1';
  const isStepTimer = variationId === 'step-timer-1';
  const isTimeProgress = variationId === 'time-progress-1';
  const isPoll = variationId === 'poll-1';
  const isMythFact = variationId === 'myth-fact-1';
  const isVersus = variationId === 'versus-1';
  const isPriceReveal = variationId === 'price-reveal-1';
  const isClientQuestion = variationId === 'client-question-1';
  const isComeWithMe = variationId === 'come-with-me-1';
  const isOrganic =
    isCaptionTease ||
    isFadeBenefits ||
    isAestheticLine ||
    isNumberedList ||
    isInsOuts ||
    isQuestionCta ||
    isImproves ||
    isStepTimer ||
    isTimeProgress ||
    isPoll ||
    isMythFact ||
    isVersus ||
    isPriceReveal ||
    isClientQuestion ||
    isComeWithMe;

  const hasOfferCard = isTextOnly && !!draftConfig.offerCard;
  const hasOrganicConfig =
    isTextOnly &&
    ((isCaptionTease && !!draftConfig.captionTease) ||
      (isFadeBenefits && !!draftConfig.fadeBenefits) ||
      (isAestheticLine && !!draftConfig.aestheticLine) ||
      (isNumberedList && !!draftConfig.numberedList) ||
      (isInsOuts && !!draftConfig.insOuts) ||
      (isQuestionCta && !!draftConfig.questionCta) ||
      (isImproves && !!draftConfig.improves) ||
      (isStepTimer && !!draftConfig.stepTimer) ||
      (isTimeProgress && !!draftConfig.timeProgress) ||
      (isPoll && !!draftConfig.poll) ||
      (isMythFact && !!draftConfig.mythFact) ||
      (isVersus && !!draftConfig.versus) ||
      (isPriceReveal && !!draftConfig.priceReveal) ||
      (isClientQuestion && !!draftConfig.clientQuestion) ||
      (isComeWithMe && !!draftConfig.comeWithMe));
  if (isTextOnly) {
    if (
      !hasOfferCard &&
      !hasOrganicConfig &&
      (!draftConfig.textFrames || draftConfig.textFrames.length === 0)
    ) {
      throw new Error(
        `Video ${videoId}: text_only mode requires text frames, an offer card, or an organic template config`
      );
    }
    if (!draftConfig.bRollClips || draftConfig.bRollClips.length === 0) {
      throw new Error(
        `Video ${videoId}: text_only mode requires at least one b-roll clip for visual content`
      );
    }
  } else if (isAiVoiceover) {
    if (!draftConfig.scriptText) {
      throw new Error(`Video ${videoId}: AI voiceover requires scriptText`);
    }
    if (!draftConfig.aiVoiceId) {
      throw new Error(`Video ${videoId}: AI voiceover requires aiVoiceId`);
    }
    if (!draftConfig.bRollClips || draftConfig.bRollClips.length === 0) {
      throw new Error(
        `Video ${videoId}: AI voiceover requires at least one b-roll clip for visual content`
      );
    }
  } else {
    if (
      !draftConfig.talkingHeadUrl ||
      draftConfig.talkingHeadUrl.trim() === ''
    ) {
      throw new Error(
        `Video ${videoId}: Recorded narration requires a talkingHeadUrl`
      );
    }
  }

  try {
    // Step 1: Get organization details for outro
    await updateVideoStage(videoId, 'downloading');
    if (timings) timings.downloadStart = Date.now();
    onProgress?.('Loading organization', 0.05);
    const org = await getOrganizationDetails(organizationId);

    // ================================================================
    // Branch: Text Only (no audio at all — text frames over b-roll)
    // ================================================================
    if (isTextOnly) {
      if (timings) timings.downloadEnd = Date.now();

      // Get template + music track info early (needed for educational BPM calc)
      const template = templateId ? getTemplateById(templateId) : undefined;
      const selectedTrack =
        template?.musicTracks && draftConfig.musicTrackId
          ? template.musicTracks.find((t) => t.id === draftConfig.musicTrackId)
          : undefined;

      // Calculate total duration
      // For offer templates: use variation-based durations
      // For educational templates: beat-synced duration
      // For text frame templates: sum text frame durations
      let textFrames = draftConfig.textFrames || [];

      // Fallback: if educational template has no textFrames but has scriptText,
      // auto-parse the script into styled text frames
      if (isEducational && textFrames.length === 0 && draftConfig.scriptText) {
        const lines = draftConfig.scriptText
          .split('\n')
          .map((l: string) => l.trim())
          .filter(Boolean);
        textFrames = lines.map((line: string, i: number) => {
          const lower = line.toLowerCase();
          let style: 'question' | 'answer' | 'disclaimer' | 'cta' = 'answer';
          if (i === 0) {
            style = 'question';
          } else if (
            // Keep this regex in sync with the synth-side parser at
            // `packages/features/src/videos/services/create-video/
            // synthesize-draft-config.ts` → `deriveTextFramesFromScript`.
            // Drift causes the CTA frame to render twice: once as an item
            // and once as the educationalConfig.ctaText fallback.
            /\b(book|link in bio|consultation$|book now|dm (us|to|me|for)|send (us )?(a )?dm|message us|tap (to|the link)|swipe up|call (us|now)|reach out|get in touch|learn more|find out more|follow us|sign up)\b/i.test(
              lower
            ) &&
            !/results vary|consultation required/i.test(lower)
          ) {
            style = 'cta';
          } else if (/results vary|consultation required/i.test(lower)) {
            style = 'disclaimer';
          }
          return { id: `tf-${i}`, text: line, durationSec: 3, style };
        });
      }

      let totalDurationSec: number;

      if (isEducational && textFrames.length > 0) {
        // Educational: beat-synced duration
        const bpm = selectedTrack?.bpm || 100;
        const beatsPerItem = template?.beatsPerEdit || 4;
        const secPerBeatGroup = (60 / bpm) * beatsPerItem;

        // Parse text frames into question, items, CTA
        const questionFrame = textFrames.find((f) => f.style === 'question');
        const itemFrames = textFrames.filter(
          (f) =>
            f.style === 'answer' ||
            f.style === 'default' ||
            f.style === 'disclaimer'
        );
        const ctaFrame = textFrames.find((f) => f.style === 'cta');

        // Total elements: question + items + CTA
        const totalElements =
          (questionFrame ? 1 : 0) + itemFrames.length + (ctaFrame ? 1 : 0);
        const holdDurationSec = secPerBeatGroup; // Hold everything visible at end
        totalDurationSec = totalElements * secPerBeatGroup + holdDurationSec;
      } else if (isOrganic) {
        // Organic templates: ~8s baseline.
        // Improves grows with the number of benefit items (1 + N + 1 segments
        // × 1.6s each) so the per-clip pacing stays consistent regardless of
        // how many items the user supplies.
        const segPerSec = 1.6;
        if (isImproves && draftConfig.improves) {
          const segments = draftConfig.improves.items.length + 2;
          totalDurationSec = segments * segPerSec;
        } else if (isFadeBenefits && draftConfig.fadeBenefits) {
          // One benefit statement at a time; duration scales with the count.
          const secondsPerLine = draftConfig.fadeBenefits.secondsPerLine ?? 2.6;
          totalDurationSec =
            draftConfig.fadeBenefits.lines.length * secondsPerLine;
        } else if (isNumberedList && draftConfig.numberedList) {
          // Title + staggered items; give each item ~1.4s plus a hold.
          totalDurationSec = 4 + draftConfig.numberedList.items.length * 1.4;
        } else if (isStepTimer && draftConfig.stepTimer) {
          // One timed step at a time; duration scales with the step count.
          totalDurationSec = draftConfig.stepTimer.steps.length * 2.6;
        } else if (isMythFact && draftConfig.mythFact) {
          const segs =
            draftConfig.mythFact.pairs.length * 2 +
            (draftConfig.mythFact.ctaText ? 1 : 0);
          totalDurationSec = segs * 2.4;
        } else if (isVersus && draftConfig.versus) {
          totalDurationSec = (draftConfig.versus.rounds.length + 2) * 2.3;
        } else if (isPriceReveal && draftConfig.priceReveal) {
          totalDurationSec = (draftConfig.priceReveal.items.length + 2) * 2.2;
        } else if (isClientQuestion && draftConfig.clientQuestion) {
          const segs =
            draftConfig.clientQuestion.answers.length +
            (draftConfig.clientQuestion.ctaText ? 1 : 0);
          totalDurationSec = segs * 2.6;
        } else if (isComeWithMe && draftConfig.comeWithMe) {
          totalDurationSec = (draftConfig.comeWithMe.steps.length + 2) * 2.4;
        } else {
          // Caption-tease, aesthetic-line, time-progress: ~8s baseline.
          totalDurationSec = 8;
        }
      } else if (hasOfferCard && textFrames.length === 0) {
        // Offer-only: duration based on variation
        switch (variationId) {
          case 'offer-square-1':
            totalDurationSec = 20; // 15-30s configurable, default 20s
            break;
          default:
            totalDurationSec = 10;
        }
      } else {
        const totalTextDurationSec = textFrames.reduce(
          (sum, frame) => sum + frame.durationSec,
          0
        );
        totalDurationSec = totalTextDurationSec;
      }
      // Organic templates normally have no outro. When the user toggles one on,
      // extend the timeline so the branded outro plays AFTER the text rather
      // than overlaying the final statement (b-roll fills the added tail).
      if (isOrganic && draftConfig.outro) {
        totalDurationSec += draftConfig.outro.durationSec || 3;
      }
      const totalDurationFrames = Math.round(totalDurationSec * fps);

      // Build Remotion text frames with frame-based timing
      let currentFrame = 0;
      const remotionTextFrames = textFrames.map((frame) => {
        const durationInFrames = Math.round(frame.durationSec * fps);
        const result = {
          id: frame.id,
          text: frame.text,
          startFrame: currentFrame,
          durationInFrames,
          style: frame.style,
        };
        currentFrame += durationInFrames;
        return result;
      });

      // Resolve b-roll assets
      await updateVideoStage(videoId, 'resolving_assets');
      if (timings) timings.resolveAssetsStart = Date.now();
      onProgress?.('Resolving b-roll assets', 0.3);
      const bRollAssetIds = (draftConfig.bRollClips || []).map(
        (clip: BRollClipConfig) => clip.assetId
      );
      const bRollAssetMap = await resolveBRollAssets(bRollAssetIds);
      if (timings) timings.resolveAssetsEnd = Date.now();

      // Footage-aware accent for organic overlays: vision-pick a colour from
      // the first clip's thumbnail. Falls back to the org brand colour, then
      // the curated reel palette inside each layer.
      let footageScheme: { accent: string; deep: string } | null = null;
      if (isOrganic) {
        const firstThumb = (draftConfig.bRollClips || [])
          .map(
            (c: BRollClipConfig) => bRollAssetMap.get(c.assetId)?.thumbnailUrl
          )
          .find((t): t is string => !!t);
        if (firstThumb) {
          footageScheme = await deriveFootageAccent(firstThumb, log);
        }
      }
      const organicAccent =
        footageScheme?.accent || org?.primaryColor || undefined;
      const organicDeep = footageScheme?.deep || undefined;

      // Schedule b-roll to fill the full timeline
      if (timings) timings.scheduleBRollStart = Date.now();
      onProgress?.('Scheduling b-roll', 0.5);
      const bRollClips: BRollClip[] = (draftConfig.bRollClips || [])
        // Return type annotated so the `clip is BRollClip` predicate below is a
        // legal narrowing: inferred, `clipType` is the draft's narrower union.
        .map((clip: BRollClipConfig, index: number): BRollClip | null => {
          const assetData = bRollAssetMap.get(clip.assetId);
          if (!assetData) {
            log.warn(`B-roll asset not found: ${clip.assetId}`);
            return null;
          }
          return {
            id: clip.assetId,
            url: assetData.url,
            sourceDurationSec: assetData.durationSec,
            order: clip.order ?? index,
            clipType: clip.clipType,
            mediaType: assetData.mediaType,
            actionSegments: assetData.actionSegments,
          };
        })
        .filter((clip): clip is BRollClip => clip !== null);

      const scheduledBRoll = scheduleBRollClips(bRollClips, {
        totalDurationSec,
        introSec: 0,
        // No outro buffer for text-only videos: b-roll plays through the full
        // duration and the outro layout renders ON TOP. Stopping b-roll early
        // would leave black frames since there's no talking head underneath.
        outroBufferSec: 0,
        minClipDurationSec: 2,
        maxClipDurationSec: 5,
        // No gaps — there's no talking head underneath, gaps show as black
        gapBetweenClipsSec: 0,
        fps,
        bpm: selectedTrack?.bpm,
        beatsPerEdit: template?.beatsPerEdit,
        targetCoverage: 1.0, // Fill full timeline (no talking head underneath)
        // Improves, fade-benefits and step-timer recycle clips because each
        // beat/line/step shows a different angle even if the user only uploads
        // 2-3 files.
        recycleClips: isImproves || isFadeBenefits || isStepTimer,
      });

      // For improves: replace the BPM-driven schedule with strictly equal
      // segments — one per text state (service name + N items + CTA). The
      // ImprovesLayer maps text 1:1 onto these scenes so the on-screen copy
      // changes exactly when the visual cuts.
      if (isImproves && draftConfig.improves && bRollClips.length > 0) {
        scheduledBRoll.length = 0;
        const segments = draftConfig.improves.items.length + 2;
        const segDurSec = totalDurationSec / segments;
        scheduledBRoll.push(
          ...scheduleCopyDrivenBRoll(
            bRollClips,
            Array.from({ length: segments }, (_, i) => ({
              startTimeSec: i * segDurSec,
              durationSec: segDurSec,
            }))
          )
        );
      }

      // Fade-benefits: one clip per line so the statement changes exactly when
      // the b-roll cuts. Build equal per-line clips across the text portion,
      // then fill any outro tail with recycled clips. FadeBenefitsLayer maps
      // each line 1:1 onto the first N (= line count) scenes.
      if (isFadeBenefits && draftConfig.fadeBenefits && bRollClips.length > 0) {
        scheduledBRoll.length = 0;
        const lineCount = draftConfig.fadeBenefits.lines.length;
        const perLineSec = draftConfig.fadeBenefits.secondsPerLine ?? 2.6;
        // One slot per line (the text portion), plus an outro tail when the
        // lines don't reach the master end. The tail is scheduled in the SAME
        // pass so it draws from the monotonic assignment rather than restarting
        // the clip list — filling it separately is how the opening shot came
        // back as the closing shot.
        const textEnd = lineCount * perLineSec;
        const fbSlots = Array.from({ length: lineCount }, (_, i) => ({
          startTimeSec: i * perLineSec,
          durationSec: perLineSec,
        }));
        if (textEnd < totalDurationSec - 0.05) {
          fbSlots.push({
            startTimeSec: textEnd,
            durationSec: totalDurationSec - textEnd,
          });
        }
        scheduledBRoll.push(...scheduleCopyDrivenBRoll(bRollClips, fbSlots));
      }

      // Step-timer syncs one step per clip, mirroring fade-benefits: build
      // equal per-step clips across the timeline. StepTimerLayer maps each step
      // 1:1 onto the first N (= step count) scenes.
      if (isStepTimer && draftConfig.stepTimer && bRollClips.length > 0) {
        scheduledBRoll.length = 0;
        const stepCount = draftConfig.stepTimer.steps.length;
        const perStepSec =
          stepCount > 0 ? totalDurationSec / stepCount : totalDurationSec;
        scheduledBRoll.push(
          ...scheduleCopyDrivenBRoll(
            bRollClips,
            Array.from({ length: stepCount }, (_, i) => ({
              startTimeSec: i * perStepSec,
              durationSec: perStepSec,
            }))
          )
        );
      }

      // RENDER-STAGE PROVENANCE. The plan row written by plan-video-detail
      // records what was SELECTED; every override above runs later, here, so a
      // clean plan row and a repeating video are entirely compatible — which is
      // exactly what happened after #703 and why the next duplicate was found
      // by a person watching a video rather than by a query.
      //
      // `mediaSource: 'none'` makes no claim: this row is about SCHEDULING, and
      // the worker does not know whether a clip is the org's own or stock.
      // `detail.stage = 'render'` is the discriminator — filter on it, and
      // exclude it from media-source reporting. Multi-row-per-video is already
      // the norm (queue-video-export writes its own with detail.selector).
      void recordProvenanceSafe(db, {
        organizationId,
        subjectType: 'video',
        subjectId: videoId,
        mediaSource: 'none',
        templateSlug: variationId,
        detail: summariseRenderSchedule({
          scheduler: isImproves
            ? 'improves'
            : isFadeBenefits
              ? 'fade-benefits'
              : isStepTimer
                ? 'step-timer'
                : 'beat-synced',
          templateId,
          variationId,
          plannedClipIds: bRollClips.map((c) => c.id),
          scheduled: scheduledBRoll,
        }) as unknown as Record<string, unknown>,
      });

      const clipLookup = new Map(bRollClips.map((c) => [c.id, c]));
      const bRollScenes = scheduledClipsToScenes(
        scheduledBRoll,
        fps,
        clipLookup
      );
      if (timings) timings.scheduleBRollEnd = Date.now();

      // Build config
      if (timings) timings.buildConfigStart = Date.now();
      onProgress?.('Building video config', 0.7);

      // Educational templates omit the outro — CTA is the ending
      const outroConfig = isEducational ? undefined : draftConfig.outro;
      // Default to the logo + location card unless the org picked otherwise.
      const outroLayoutStyle =
        outroConfig?.outroStyle || org?.outroStyle || 'location';
      const rawOutroLogoUrl = outroConfig?.logoUrl || org?.logo || undefined;
      const outroLayout = outroConfig
        ? {
            layout: outroLayoutStyle,
            businessName: outroConfig.businessName || org?.name || '',
            tagline: org?.tagline || undefined,
            primaryColor: org?.primaryColor || '#C9A96A',
            secondaryColor: org?.secondaryColor || '#8b5cf6',
            backgroundColor: org?.backgroundColor || '#FFFFFF',
            address: org?.address || undefined,
            ctaText: outroConfig.ctaText || 'Book Now',
            logoUrl: rawOutroLogoUrl
              ? await presignS3UrlIfNeeded(rawOutroLogoUrl)
              : undefined,
            durationInFrames: Math.round((outroConfig.durationSec || 3) * fps),
          }
        : undefined;

      // Keyed on `musicTrackId` (not `musicUrl`) so a frontend that failed to
      // build an absolute `musicUrl` (e.g. `useRuntimeConfig().cdnUrl` still
      // loading at submit time) still gets music — `resolveMusicUrl` falls
      // back to the registry-resolved `selectedTrack.path`. See
      // `./music-url.ts` for the full explanation.
      // resolveMusicUrl returns undefined when neither an explicit musicUrl nor a
      // track path resolves. A music block with no url is worse than no music: the
      // renderer gets an Audio src of undefined. Drop the block instead.
      const resolvedMusicUrl = resolveMusicUrl(
        draftConfig.musicUrl,
        selectedTrack?.path
      );
      const music =
        draftConfig.musicTrackId && resolvedMusicUrl
          ? {
              trackId: draftConfig.musicTrackId,
              url: resolvedMusicUrl,
              volume: draftConfig.musicVolume || 0.05,
            }
          : undefined;

      // Build educationalConfig from textFrames for educational templates
      let educationalConfig:
        | {
            questionText: string;
            items: string[];
            ctaText: string;
            primaryColor: string;
            bpm?: number;
            beatsPerItem?: number;
          }
        | undefined;

      if (isEducational && textFrames.length > 0) {
        const questionFrame = textFrames.find((f) => f.style === 'question');
        const itemFrames = textFrames.filter(
          (f) =>
            f.style === 'answer' ||
            f.style === 'default' ||
            f.style === 'disclaimer'
        );
        const ctaFrame = textFrames.find((f) => f.style === 'cta');

        educationalConfig = {
          questionText: questionFrame?.text || textFrames[0]?.text || '',
          items: itemFrames.map((f) => f.text),
          ctaText: ctaFrame?.text || 'DM to Learn More',
          primaryColor: org?.primaryColor || '#6366f1',
          bpm: selectedTrack?.bpm || 100,
          beatsPerItem: template?.beatsPerEdit || 4,
        };
      }

      if (timings) timings.buildConfigEnd = Date.now();
      onProgress?.('Config ready', 0.8);

      return {
        scenes: [...bRollScenes],
        captionPages: [], // No captions for text_only
        tikTokCaptionStyle: {
          position: 'center' as const,
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 64,
          color: '#FFFFFF',
          highlightColor: '#FFFFFF',
          backgroundColor: 'transparent',
          showBackground: false,
          strokeWidth: 20,
          strokeColor: '#000000',
        },
        music,
        textFrames: remotionTextFrames,
        // Offer card overlay for offer templates
        offerCard: draftConfig.offerCard
          ? {
              serviceName: draftConfig.offerCard.serviceName,
              serviceDescription: draftConfig.offerCard.serviceDescription,
              headline: draftConfig.offerCard.headline,
              originalPriceCents: draftConfig.offerCard.originalPriceCents,
              offerPriceCents: draftConfig.offerCard.offerPriceCents,
              discountPercent: draftConfig.offerCard.discountPercent,
              bulletPoints: draftConfig.offerCard.bulletPoints,
              ctaText: draftConfig.offerCard.ctaText,
              urgencyText: draftConfig.offerCard.urgencyText,
              audienceText: draftConfig.offerCard.audienceText,
              logoUrl: draftConfig.offerCard.logoUrl
                ? await presignS3UrlIfNeeded(draftConfig.offerCard.logoUrl)
                : undefined,
              businessName: draftConfig.offerCard.businessName,
              primaryColor: draftConfig.offerCard.primaryColor,
              secondaryColor: draftConfig.offerCard.secondaryColor,
              currencyCode: draftConfig.offerCard.currencyCode,
            }
          : undefined,
        educationalConfig,
        // Organic templates: pass the matching config block through to Remotion.
        // Only one is populated per draft, gated by variationId.
        captionTease: isCaptionTease ? draftConfig.captionTease : undefined,
        fadeBenefits:
          isFadeBenefits && draftConfig.fadeBenefits?.highlight
            ? {
                ...draftConfig.fadeBenefits,
                primaryColor: organicAccent,
              }
            : isFadeBenefits
              ? draftConfig.fadeBenefits
              : undefined,
        aestheticLine: isAestheticLine ? draftConfig.aestheticLine : undefined,
        // Brand accent: the org colour (when set) takes the ONE accent slot
        // per template — badges, pills, active chips. Everything else runs the
        // curated editorial reel palette (REEL_PALETTE), which also fills in
        // for orgs with no brand colour. Layers pick readable text via
        // accentTextColor().
        numberedList:
          isNumberedList && draftConfig.numberedList
            ? {
                ...draftConfig.numberedList,
                primaryColor: organicAccent,
              }
            : undefined,
        insOuts:
          isInsOuts && draftConfig.insOuts
            ? {
                ...draftConfig.insOuts,
                primaryColor: organicAccent,
              }
            : undefined,
        questionCta:
          isQuestionCta && draftConfig.questionCta
            ? {
                ...draftConfig.questionCta,
                primaryColor: organicAccent,
              }
            : undefined,
        improves: isImproves ? draftConfig.improves : undefined,
        stepTimer:
          isStepTimer && draftConfig.stepTimer
            ? {
                ...draftConfig.stepTimer,
                primaryColor: organicAccent,
                secondaryColor: organicDeep,
              }
            : undefined,
        timeProgress:
          isTimeProgress && draftConfig.timeProgress
            ? {
                ...draftConfig.timeProgress,
                primaryColor: organicAccent,
                businessName: org?.name || undefined,
              }
            : undefined,
        poll:
          isPoll && draftConfig.poll
            ? {
                ...draftConfig.poll,
                primaryColor: organicAccent,
                secondaryColor: organicDeep,
              }
            : undefined,
        mythFact: isMythFact ? draftConfig.mythFact : undefined,
        versus:
          isVersus && draftConfig.versus
            ? { ...draftConfig.versus, primaryColor: organicAccent }
            : undefined,
        priceReveal:
          isPriceReveal && draftConfig.priceReveal
            ? { ...draftConfig.priceReveal, primaryColor: organicAccent }
            : undefined,
        clientQuestion: isClientQuestion
          ? draftConfig.clientQuestion
          : undefined,
        comeWithMe: isComeWithMe ? draftConfig.comeWithMe : undefined,
        variationId,
        outroLayout,
        orientation: draftConfig.orientation || 'portrait',
        fps,
        durationInFrames: totalDurationFrames,
      };
    }

    // ================================================================
    // Branch: AI Voiceover vs Recorded Talking Head
    // ================================================================
    let audioPath: string;
    let audioDurationSec: number;
    let presignedTalkingHeadUrl: string | undefined;
    let narrationAudioUrl: string | undefined;

    if (isAiVoiceover) {
      // --- AI Voiceover path ---
      if (!draftConfig.scriptText) {
        throw new Error('No script text provided for AI voiceover');
      }
      if (!draftConfig.aiVoiceId) {
        throw new Error('No AI voice selected for voiceover');
      }

      // Generate TTS audio from script
      await updateVideoStage(videoId, 'generating_voiceover');
      if (timings) timings.generateVoiceoverStart = Date.now();
      onProgress?.('Generating voiceover', 0.1);

      log.info(`Generating TTS for video ${videoId}`, {
        voice: draftConfig.aiVoiceId,
      });
      const ttsResult = await generateTts(
        draftConfig.scriptText,
        draftConfig.aiVoiceId as KokoroVoice
      );
      audioDurationSec = ttsResult.audioLength;

      // Write TTS audio to temp WAV file
      audioPath = path.join(
        os.tmpdir(),
        `video-worker-${Date.now()}-tts-${videoId}.wav`
      );
      fs.writeFileSync(audioPath, Buffer.from(ttsResult.audio));
      tempFiles.push(audioPath);

      // Upload TTS audio to S3 for Remotion Lambda
      const ttsKey = `${organizationId}/videos/tts/${videoId}-${Date.now()}.wav`;
      const orgBucket = getOrgAssetsBucket();
      await upload({
        key: ttsKey,
        body: Buffer.from(ttsResult.audio),
        contentType: 'audio/wav',
        bucket: orgBucket,
      });
      narrationAudioUrl = await getPresignedDownloadUrl({
        key: ttsKey,
        bucket: orgBucket,
      });

      if (timings) timings.generateVoiceoverEnd = Date.now();
      if (timings) timings.downloadEnd = Date.now();
      log.info(`TTS generated: ${audioDurationSec.toFixed(1)}s audio`);
    } else {
      // --- Recorded talking head path ---
      onProgress?.('Downloading talking head', 0.1);
      if (!draftConfig.talkingHeadUrl) {
        throw new Error('No talking head video URL provided');
      }

      presignedTalkingHeadUrl = await presignS3UrlIfNeeded(
        draftConfig.talkingHeadUrl
      );
      const talkingHeadPath = await downloadToTemp(
        presignedTalkingHeadUrl,
        'talking-head.mp4'
      );
      tempFiles.push(talkingHeadPath);
      if (timings) timings.downloadEnd = Date.now();

      // Get video metadata (duration, dimensions)
      await updateVideoStage(videoId, 'analyzing');
      if (timings) timings.analyzeStart = Date.now();
      onProgress?.('Analyzing video', 0.15);
      const metadata = await getVideoMetadata(talkingHeadPath);
      audioDurationSec = metadata.duration || 30;
      if (timings) timings.analyzeEnd = Date.now();

      // Extract audio for transcription
      if (timings) timings.extractAudioStart = Date.now();
      onProgress?.('Extracting audio', 0.2);
      audioPath = talkingHeadPath.replace('.mp4', '.wav');
      tempFiles.push(audioPath);
      await extractAudioAsWav(talkingHeadPath, audioPath);
      if (timings) timings.extractAudioEnd = Date.now();
    }

    // No end padding — the outro provides transition time
    const totalDurationFrames = Math.round(audioDurationSec * fps);

    // ================================================================
    // Shared pipeline: Transcribe → Captions → B-roll → Config
    // ================================================================

    // Transcribe audio (works on any WAV — talking head or TTS)
    await updateVideoStage(videoId, 'transcribing');
    if (timings) timings.transcribeStart = Date.now();
    onProgress?.('Transcribing audio', 0.3);
    const whisperCaptions = await transcribe(audioPath);
    if (timings) timings.transcribeEnd = Date.now();

    // Align caption text to Whisper timing:
    // - User edits take highest priority
    // - For AI voiceover, use original script text (Whisper may misspell brand names)
    // - Otherwise, use raw Whisper transcription
    const captionTextSource =
      draftConfig.editedCaptionText ??
      (isAiVoiceover ? draftConfig.scriptText : null);
    const finalCaptions = captionTextSource
      ? alignEditedCaptions(whisperCaptions, captionTextSource)
      : whisperCaptions;

    // Build TikTok-style caption pages
    await updateVideoStage(videoId, 'building_captions');
    if (timings) timings.buildCaptionsStart = Date.now();
    onProgress?.('Building captions', 0.5);
    const captionPages = buildCaptionPages(finalCaptions, {
      fps,
      maxWordsPerPage: 5,
      maxPageDurationMs: 1200,
    });
    if (timings) timings.buildCaptionsEnd = Date.now();

    // Resolve b-roll asset URLs and schedule clips
    await updateVideoStage(videoId, 'resolving_assets');
    if (timings) timings.resolveAssetsStart = Date.now();
    onProgress?.('Resolving b-roll assets', 0.55);
    const bRollAssetIds = (draftConfig.bRollClips || []).map(
      (clip: BRollClipConfig) => clip.assetId
    );
    const bRollAssetMap = await resolveBRollAssets(bRollAssetIds);
    if (timings) timings.resolveAssetsEnd = Date.now();

    if (timings) timings.scheduleBRollStart = Date.now();
    onProgress?.('Scheduling b-roll', 0.6);
    const bRollClips: BRollClip[] = (draftConfig.bRollClips || [])
      // Return type annotated so the `clip is BRollClip` predicate below is a
      // legal narrowing: inferred, `clipType` is the draft's narrower union.
      .map((clip: BRollClipConfig, index: number): BRollClip | null => {
        const assetData = bRollAssetMap.get(clip.assetId);
        if (!assetData) {
          log.warn(`B-roll asset not found: ${clip.assetId}`);
          return null;
        }
        return {
          id: clip.assetId,
          url: assetData.url,
          sourceDurationSec: assetData.durationSec,
          order: clip.order ?? index,
          clipType: clip.clipType,
          mediaType: assetData.mediaType,
          actionSegments: assetData.actionSegments,
        };
      })
      .filter((clip): clip is BRollClip => clip !== null);

    // Look up template for beat-synced scheduling
    const template = templateId ? getTemplateById(templateId) : undefined;
    const selectedTrack =
      template?.musicTracks && draftConfig.musicTrackId
        ? template.musicTracks.find((t) => t.id === draftConfig.musicTrackId)
        : undefined;

    const scheduledBRoll = scheduleBRollClips(bRollClips, {
      totalDurationSec: audioDurationSec,
      introSec: isAiVoiceover ? 0 : 3, // No intro buffer for AI voiceover
      outroBufferSec: draftConfig.outro
        ? draftConfig.outro.durationSec || 3
        : 0,
      minClipDurationSec: 2,
      maxClipDurationSec: 5,
      fps,
      bpm: selectedTrack?.bpm,
      beatsPerEdit: template?.beatsPerEdit,
      // AI voiceover has no talking head underneath — fill the full timeline
      // by recycling clips so there are no black gaps
      targetCoverage: isAiVoiceover ? 1.0 : undefined,
      recycleClips: isAiVoiceover,
    });

    // Build lookup so scheduledClipsToScenes can propagate mediaType
    const clipLookup = new Map(bRollClips.map((c) => [c.id, c]));
    const bRollScenes = scheduledClipsToScenes(scheduledBRoll, fps, clipLookup);
    if (timings) timings.scheduleBRollEnd = Date.now();

    // Build scenes array
    if (timings) timings.buildConfigStart = Date.now();
    onProgress?.('Building video config', 0.7);

    const scenes = isAiVoiceover
      ? [...bRollScenes] // AI voiceover: b-roll only (no talking head)
      : [
          {
            id: 'talking-head-main',
            type: 'talking-head' as const,
            clipUrl: presignedTalkingHeadUrl as string,
            trimStart: 0,
            trimEnd: 0,
            startFrame: 0,
            durationInFrames: totalDurationFrames,
          },
          ...bRollScenes,
        ];

    // Build caption style from config
    const captionConfig = draftConfig.captions || {
      enabled: true,
      position: 'center' as const,
      fontFamily: 'Inter, system-ui, sans-serif',
      fontSize: 64,
      textColor: '#FFFFFF',
      highlightColor: '#FFFFFF',
      backgroundColor: 'transparent',
      showBackground: false,
    };

    const tikTokCaptionStyle = {
      position: captionConfig.position || 'center',
      fontFamily: captionConfig.fontFamily || 'Inter, system-ui, sans-serif',
      fontSize: captionConfig.fontSize || 64,
      color: captionConfig.textColor || '#FFFFFF',
      highlightColor: captionConfig.highlightColor || '#FFFFFF',
      backgroundColor: captionConfig.backgroundColor || 'transparent',
      showBackground: captionConfig.showBackground || false,
      strokeWidth: 20,
      strokeColor: '#000000',
    };

    // Build outro layout config from org preferences + draft config
    const outroConfig = draftConfig.outro;
    // Default to the logo + location card unless the org picked otherwise.
    const outroLayoutStyle =
      outroConfig?.outroStyle || org?.outroStyle || 'location';
    const rawLogoUrl = outroConfig?.logoUrl || org?.logo || undefined;
    const outroLayout = outroConfig
      ? {
          layout: outroLayoutStyle,
          businessName: outroConfig.businessName || org?.name || '',
          tagline: org?.tagline || undefined,
          primaryColor: org?.primaryColor || '#C9A96A',
          secondaryColor: org?.secondaryColor || '#8b5cf6',
          backgroundColor: org?.backgroundColor || '#FFFFFF',
          address: org?.address || undefined,
          ctaText: outroConfig.ctaText || 'Book Now',
          logoUrl: rawLogoUrl
            ? await presignS3UrlIfNeeded(rawLogoUrl)
            : undefined,
          durationInFrames: Math.round((outroConfig.durationSec || 3) * fps),
        }
      : undefined;

    // Build music config. Keyed on `musicTrackId` (not `musicUrl`) — see
    // `resolveMusicUrl` for why a missing `musicUrl` shouldn't drop music.
    // resolveMusicUrl returns undefined when neither an explicit musicUrl nor a
    // track path resolves. A music block with no url is worse than no music: the
    // renderer gets an Audio src of undefined. Drop the block instead.
    const resolvedMusicUrl = resolveMusicUrl(
      draftConfig.musicUrl,
      selectedTrack?.path
    );
    const music =
      draftConfig.musicTrackId && resolvedMusicUrl
        ? {
            trackId: draftConfig.musicTrackId,
            url: resolvedMusicUrl,
            volume: draftConfig.musicVolume || 0.05,
          }
        : undefined;

    // Build narration audio config (AI voiceover only)
    const narrationAudio =
      isAiVoiceover && narrationAudioUrl
        ? { url: narrationAudioUrl, volume: 1 }
        : undefined;

    // Build PiP overlays (convert seconds to frames)
    // Presign S3 URLs so Remotion Lambda can access them
    const pipOverlays = draftConfig.pipOverlays
      ? await Promise.all(
          draftConfig.pipOverlays.map(async (pip) => ({
            imageUrl: await presignS3UrlIfNeeded(pip.imageUrl),
            label: pip.label,
            position: pip.position,
            startFrame: Math.round(pip.startSec * fps),
            durationInFrames: Math.round(pip.durationSec * fps),
            sizePercent: pip.sizePercent,
            soundEffectUrl: pip.soundEffectUrl
              ? await presignS3UrlIfNeeded(pip.soundEffectUrl)
              : undefined,
          }))
        )
      : undefined;

    // Build modular before-after overlays for before-after-1 variation
    // These replace the legacy BeforeAfterRevealLayer with composable components:
    // - PiP overlay for the "before" photo
    // - TextInterstitial for "CLIENT RESULTS COMING NOW"
    // - FullScreenReveal for the "after" photo with Ken Burns
    let textInterstitials: VideoConfig['textInterstitials'];
    let fullScreenReveals: VideoConfig['fullScreenReveals'];

    if (variationId === 'before-after-1') {
      const beforeScene = bRollScenes.find((s) => s.bRollType === 'before');
      const afterScene = bRollScenes.find((s) => s.bRollType === 'after');

      if (beforeScene && afterScene) {
        // Text appears 0.5s after the before PiP disappears
        const beforeEndFrame =
          beforeScene.startFrame + beforeScene.durationInFrames;
        const textGapFrames = Math.round(0.5 * fps);
        const textStartFrame = beforeEndFrame + textGapFrames;
        // Text visible until 0.5s before the after reveal
        const textBufferFrames = Math.round(0.5 * fps);
        const textDurationFrames = Math.max(
          Math.round(0.5 * fps), // minimum 0.5s
          afterScene.startFrame - textStartFrame - textBufferFrames
        );

        textInterstitials = [
          {
            text: 'CLIENT RESULTS COMING NOW',
            startFrame: textStartFrame,
            durationInFrames: textDurationFrames,
            verticalPosition: 0.33,
            fontSize: 72,
          },
        ];

        // After photo as full-screen reveal with Ken Burns
        fullScreenReveals = [
          {
            src: afterScene.clipUrl,
            mediaType:
              (afterScene as { mediaType?: 'image' | 'video' }).mediaType ||
              'image',
            startFrame: afterScene.startFrame,
            durationInFrames: afterScene.durationInFrames,
            trimStart: afterScene.trimStart,
            zoomRange: [1.0, 1.12],
            transition: 'fade' as const,
            transitionDurationFrames: 8,
            label: 'AFTER',
            labelPosition: 'top-left' as const,
            // soundEffectUrl omitted — component defaults to whoosh
          },
        ];
      }
    }

    if (timings) timings.buildConfigEnd = Date.now();
    onProgress?.('Config ready', 0.8);

    return {
      scenes,
      captionPages: captionConfig.enabled !== false ? captionPages : [],
      tikTokCaptionStyle,
      music,
      narrationAudio,
      outroLayout,
      variationId,
      textInterstitials,
      fullScreenReveals,
      orientation: draftConfig.orientation || 'portrait',
      fps,
      durationInFrames: totalDurationFrames,
      pipOverlays,
    };
  } finally {
    // Cleanup temp files
    cleanupTempFiles(...tempFiles);
  }
}

/**
 * Update video progress in database
 */
async function updateVideoProgress(
  videoId: string,
  progress: number
): Promise<void> {
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(video)
            .set({ progress: Math.round(progress * 100) })
            .where(eq(video.id, videoId)),
        { db }
      ),
    WORKER_DB_WRITE_RETRY
  );
}

/**
 * Update video processing stage in database
 * Reports detailed progress during video processing
 */
async function updateVideoStage(
  videoId: string,
  stage: VideoProcessingStage
): Promise<void> {
  log.info(`Video ${videoId} stage: ${stage}`);
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(video)
            .set({
              processingStage: stage,
              stageStartedAt: new Date(),
            })
            .where(eq(video.id, videoId)),
        { db }
      ),
    WORKER_DB_WRITE_RETRY
  );
}

/**
 * Update video status to processing
 */
async function markVideoProcessing(videoId: string): Promise<void> {
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(video)
            .set({ status: 'processing', progress: 0 })
            .where(eq(video.id, videoId)),
        { db }
      ),
    WORKER_DB_WRITE_RETRY
  );
}

/**
 * Copy rendered video from Remotion bucket to org-assets bucket
 * Returns the CDN URL for the copied video
 *
 * @param remotionOutputUrl - The S3 URL from Remotion Lambda output
 * @param organizationId - Organization ID for path scoping
 * @param videoId - Video ID for unique filename
 * @returns CDN URL for the video, or original URL if CDN is not enabled
 */
async function copyVideoToOrgAssets(
  remotionOutputUrl: string,
  organizationId: string,
  videoId: string
): Promise<string> {
  // If CDN is not enabled, return the original URL with presigning
  if (!isCdnEnabled()) {
    log.info('CDN not enabled, using presigned URL for video');
    return presignS3UrlIfNeeded(remotionOutputUrl);
  }

  const orgAssetsBucket = getOrgAssetsBucket();
  const timestamp = Date.now();
  const key = `${organizationId}/videos/rendered/${videoId}-${timestamp}.mp4`;

  log.info(`Copying video to org-assets: ${key}`);

  try {
    // Presign the Remotion URL if needed (it's a private bucket)
    const presignedSourceUrl = await presignS3UrlIfNeeded(remotionOutputUrl);

    // Download → faststart remux → upload for progressive playback
    const tempDir = os.tmpdir();
    const rawPath = path.join(tempDir, `${videoId}-raw.mp4`);
    const fastStartPath = path.join(tempDir, `${videoId}-faststart.mp4`);

    try {
      log.info('Downloading rendered video for faststart remux...');
      await downloadToFile(presignedSourceUrl, rawPath);

      log.info('Remuxing with faststart (moov atom at beginning)...');
      await addFastStart(rawPath, fastStartPath);

      log.info('Uploading faststart video to org-assets...');
      const fastStartBuffer = fs.readFileSync(fastStartPath);
      await upload({
        bucket: orgAssetsBucket,
        key,
        body: fastStartBuffer,
        contentType: 'video/mp4',
      });
    } finally {
      // Cleanup temp files
      for (const p of [rawPath, fastStartPath]) {
        try {
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }
    }

    // Return the CDN URL
    const cdnUrl = getPrivateCdnUrl(key);
    log.info(`Video copied successfully with faststart: ${cdnUrl}`);

    return cdnUrl;
  } catch (error) {
    logError('video-worker.copyVideoToOrgAssets', error, {
      feature: 'video-worker',
      extra: { remotionOutputUrl },
    });
    // Fall back to direct copy without faststart
    log.info('Falling back to direct copy without faststart');
    try {
      const presignedSourceUrl = await presignS3UrlIfNeeded(remotionOutputUrl);
      await copyFromUrl({
        sourceUrl: presignedSourceUrl,
        bucket: orgAssetsBucket,
        key,
        contentType: 'video/mp4',
      });
      return getPrivateCdnUrl(key);
    } catch {
      return presignS3UrlIfNeeded(remotionOutputUrl);
    }
  }
}

/**
 * Extract a thumbnail frame from the rendered video and upload to S3.
 * Returns the CDN/presigned URL of the thumbnail, or null if extraction fails.
 */
async function generateThumbnail(
  videoUrl: string,
  organizationId: string,
  videoId: string
): Promise<string | null> {
  const tempDir = path.join(os.tmpdir(), `thumb-${videoId}-${Date.now()}`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // Download video to temp file
    const tempVideoPath = path.join(tempDir, 'video.mp4');
    const presignedUrl = await presignS3UrlIfNeeded(videoUrl);
    const response = await fetch(presignedUrl);
    if (!response.ok) {
      throw new Error(`Failed to download video: ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(tempVideoPath, buffer);

    // Extract a single frame from the middle of the video
    const framePaths = await extractKeyFrames(tempVideoPath, {
      count: 1,
      outputDir: tempDir,
      quality: 3, // High quality thumbnail
    });

    if (framePaths.length === 0) {
      throw new Error('No frames extracted');
    }

    // Upload thumbnail to S3
    const thumbnailKey = `${organizationId}/videos/thumbnails/${videoId}.jpg`;
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

    log.info(`Thumbnail generated for video ${videoId}: ${thumbnailUrl}`);
    return thumbnailUrl;
  } catch (error) {
    logError('video-worker.generateThumbnail', error, {
      feature: 'video-worker',
      extra: { videoId, organizationId },
    });
    // Non-fatal: video still works without a thumbnail
    return null;
  } finally {
    // Clean up temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * A finished render is the last thing that has to happen before a content batch
 * can be reviewed — and until now nothing told the batch. Its status entered
 * `'generating'` at the end of the seed and stayed there for good, so anything
 * server-side asking "is this batch done?" (a proactive Claire, the status
 * readout in settings) had nothing true to read. Settle it here, where the
 * render actually ends.
 *
 * Standalone videos have no batch and resolve to a no-op. Never allowed to
 * disturb the render: a stale status is a far smaller problem than a throw
 * that strands a video the owner is waiting for.
 */
async function settleOwningBatch(videoId: string): Promise<void> {
  try {
    const result = await withSystemScope(
      (conn) => settleBatchForAsset(conn, { videoId }),
      { db }
    );
    if (!result.success) {
      logError('video-worker.settleBatch', new Error(result.error.message), {
        feature: 'video-worker',
        extra: { videoId },
      });
    }
  } catch (error) {
    logError('video-worker.settleBatch', error, {
      feature: 'video-worker',
      extra: { videoId },
    });
  }
}

/**
 * Mark video as ready with output URL
 */
async function markVideoReady(
  videoId: string,
  outputUrl: string,
  options?: { durationMs?: number; thumbnailUrl?: string | null }
): Promise<void> {
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(video)
            .set({
              status: 'ready',
              progress: 100,
              blobUrl: outputUrl,
              exportedAt: new Date(),
              processingStage: null, // Clear processing stage
              stageStartedAt: null,
              ...(options?.durationMs && { durationMs: options.durationMs }),
              ...(options?.thumbnailUrl && {
                thumbnailUrl: options.thumbnailUrl,
              }),
            })
            .where(eq(video.id, videoId)),
        { db }
      ),
    WORKER_DB_WRITE_RETRY
  );
  await settleOwningBatch(videoId);
}

/**
 * Mark video as failed with error message
 */
async function markVideoFailed(
  videoId: string,
  errorMessage: string
): Promise<void> {
  await withDbRetry(
    () =>
      withSystemScope(
        (conn) =>
          conn
            .update(video)
            .set({
              status: 'failed',
              errorMessage,
              // Keep processingStage to show which stage failed
            })
            .where(eq(video.id, videoId)),
        { db }
      ),
    WORKER_DB_WRITE_RETRY
  );
  // A failed render is terminal too: the batch is done waiting on this slot,
  // and the owner reviews it as a failure rather than staring at a spinner.
  await settleOwningBatch(videoId);
}

/**
 * Process a video rendering job
 */
/**
 * WhatsApp Cloud caps a video sent by link at 16MB — Meta accepts the send
 * (200 + messageId) then aborts the download mid-stream once it passes the cap
 * (status `failed`, error 131053 "HTTP source aborted"). Keep a small margin.
 */
const WHATSAPP_VIDEO_LINK_MAX_BYTES = 16 * 1024 * 1024;

/**
 * Deliver a finished Claire-on-WhatsApp render to the owner. Presigns the
 * private org-assets URL (Meta can't fetch the raw CDN URL — 403/131053), then
 * sends the video inline when it's under WhatsApp's 16MB link cap, or falls
 * back to a tappable download link as text when it's too large. Enqueues onto
 * the generic outbound transport; the API chatbot-worker does the actual send.
 */
async function deliverFinishedVideoToWhatsapp(args: {
  organizationId: string;
  createdById: string;
  conversationId: string;
  videoId: string;
  finalVideoUrl: string;
}): Promise<void> {
  const {
    organizationId,
    createdById,
    conversationId,
    videoId,
    finalVideoUrl,
  } = args;

  const deliverableUrl = await getFreshDownloadUrl(finalVideoUrl);

  // Probe the rendered size so we can pick inline-video vs link-fallback.
  let sizeBytes: number | null = null;
  try {
    const head = await fetch(deliverableUrl, { method: 'HEAD' });
    const len = head.headers.get('content-length');
    sizeBytes = len ? Number(len) : null;
  } catch (err) {
    log.warn('Could not probe video size for WhatsApp delivery', {
      videoId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const tooBig = sizeBytes != null && sizeBytes > WHATSAPP_VIDEO_LINK_MAX_BYTES;
  log.info('WhatsApp video delivery', { videoId, sizeBytes, tooBig });

  const messages = tooBig
    ? [
        {
          kind: 'text' as const,
          body: `Your video is ready! 🎬 It's a little too large to send here, so tap to watch or download:\n${deliverableUrl}`,
        },
      ]
    : [
        {
          kind: 'media' as const,
          mediaType: 'video' as const,
          link: deliverableUrl,
          caption: 'Here’s your finished video! 🎬',
        },
      ];

  const res = await queueClaireWhatsappOutbound({
    organizationId,
    userId: createdById,
    conversationId,
    messages,
    recordAs: 'Delivered the finished video.',
    dedupeKey: `video-ready:${videoId}`,
  });
  if (!res.success) {
    log.warn('Failed to enqueue Claire WhatsApp video delivery', {
      videoId,
      error: res.error.message,
    });
  }
}

async function processVideoJob(job: Job<VideoRenderJob>): Promise<void> {
  // PARSE the payload against the one declaration the producer had to satisfy.
  // `legacyDefaults` fill fields that predate the schema for jobs already in
  // Redis; anything else that doesn't match fails loudly here instead of
  // rendering the wrong video.
  const data = parseJobData(videoRenderJob, job.data);
  const {
    videoId,
    organizationId,
    draftConfig,
    templateId,
    variationId,
    createdById,
    whatsappDelivery,
  } = data;

  log.info(`Processing video: ${videoId}`);

  // Initialize timing instrumentation
  const timings: ProcessingTimings = {
    jobStarted: Date.now(),
  };

  // Mark as processing
  await markVideoProcessing(videoId);

  // Product analytics: one render attempt started. Paired with
  // video_render_completed / video_render_failed for the render success rate.
  if (isPostHogInitialized()) {
    trackOrgEvent(organizationId, 'video_render_started', {
      organizationId,
      videoId,
      templateId: templateId ?? null,
      variationId: variationId ?? null,
      createdById: createdById ?? null,
      attempt: job.attemptsMade,
    });
  }

  // Progress weights based on observed stage timings:
  //   Config building (download, voiceover, transcribe, etc.) ~13% of total time
  //   Rendering (Remotion Lambda) ~87% of total time
  // Weight the progress bar accordingly so it feels linear.
  const CONFIG_WEIGHT = 0.15;
  const RENDER_WEIGHT = 1 - CONFIG_WEIGHT; // 0.85

  // Build progress callback for both config building and rendering
  const onConfigProgress = async (stage: string, progress: number) => {
    log.info(
      `Video ${videoId} config: ${stage} (${Math.round(progress * 100)}%)`
    );
    const totalProgress = progress * CONFIG_WEIGHT;
    await updateVideoProgress(videoId, totalProgress);
    await job.updateProgress(totalProgress * 100);
  };

  // Progress callback for rendering (CONFIG_WEIGHT to 100% of total progress)
  const onRenderProgress = async (progress: RenderProgress) => {
    const totalProgress = CONFIG_WEIGHT + progress.progress * RENDER_WEIGHT;
    log.info(
      `Video ${videoId} render: ${Math.round(progress.progress * 100)}%`
    );
    await updateVideoProgress(videoId, totalProgress);
    await job.updateProgress(totalProgress * 100);
  };

  // Build the full VideoConfig from draft config (includes transcription)
  if (data.schemaVersion === 2) {
    // (message, context) — not pino's (obj, message). Reversed, the object was
    // passed as the message and the line carried no text.
    log.info('Processing v2 template job', {
      videoId,
      templateDocId: data.templateDocId,
    });

    const renderDoc = await compileRenderDoc(data, db, log);
    await withDbRetry(
      () =>
        withSystemScope(
          (conn) =>
            conn.update(video).set({ renderDoc }).where(eq(video.id, videoId)),
          { db }
        ),
      WORKER_DB_WRITE_RETRY
    );

    await updateVideoStage(videoId, 'rendering');
    timings.renderStart = Date.now();
    await loadRemotionCredentials(log);

    const result = await renderAndWaitV2(renderDoc, onRenderProgress, videoId);
    timings.renderEnd = Date.now();

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Render failed: ${result.errors.join(', ')}`);
    }

    if (!result.outputUrl) {
      throw new Error('Render completed but no output URL received');
    }

    log.info('Copying v2 video to org-assets bucket...');
    const finalVideoUrl = await copyVideoToOrgAssets(
      result.outputUrl,
      organizationId,
      videoId
    );

    log.info(`Generating thumbnail for v2 video ${videoId}...`);
    const thumbnailUrl = await generateThumbnail(
      finalVideoUrl,
      organizationId,
      videoId
    );

    timings.jobCompleted = Date.now();
    logTimings(videoId, timings);

    log.info(`Video ${videoId} completed: ${finalVideoUrl}`);
    await markVideoReady(videoId, finalVideoUrl, { thumbnailUrl });

    if (createdById) {
      sendPushNotification(db, {
        userId: createdById,
        title: 'Video ready!',
        body: 'Your video has finished processing.',
        data: { videoId, type: 'video_ready' },
      }).catch((err) => {
        log.warn('Failed to send push notification', {
          error: err instanceof Error ? err.message : String(err),
          videoId,
        });
      });
    }

    // Claire-on-WhatsApp delivery (see the v1 path below for rationale).
    if (whatsappDelivery && createdById) {
      await deliverFinishedVideoToWhatsapp({
        organizationId,
        createdById,
        conversationId: whatsappDelivery.conversationId,
        videoId,
        finalVideoUrl,
      }).catch((err) => {
        log.warn('Claire WhatsApp video delivery failed', {
          error: err instanceof Error ? err.message : String(err),
          videoId,
        });
      });
    }
    return;
  }

  const videoConfig = await buildVideoConfig(
    draftConfig,
    organizationId,
    videoId,
    onConfigProgress,
    timings,
    // The job payload carries these as nullable; buildVideoConfig takes them as
    // optional. `null` would read as "a template was chosen" downstream.
    templateId ?? undefined,
    variationId ?? undefined
  );

  // Post-build validation: ensure the built config has actual content
  const hasTalkingHead = videoConfig.scenes.some(
    (s) => s.type === 'talking-head'
  );
  const hasBRoll = videoConfig.scenes.some((s) => s.type === 'b-roll');
  const hasNarrationAudio = !!videoConfig.narrationAudio;
  const hasTextFrames =
    !!videoConfig.textFrames && videoConfig.textFrames.length > 0;
  const hasOfferCard = !!videoConfig.offerCard;
  // Organic templates each ship their copy in a dedicated config block on
  // VideoConfig — the composition picks the matching layer based on
  // variationId. Treat any of these as valid text content.
  const hasOrganicConfig =
    !!videoConfig.captionTease ||
    !!videoConfig.fadeBenefits ||
    !!videoConfig.aestheticLine ||
    !!videoConfig.numberedList ||
    !!videoConfig.insOuts ||
    !!videoConfig.questionCta ||
    !!videoConfig.improves ||
    !!videoConfig.stepTimer ||
    !!videoConfig.timeProgress ||
    !!videoConfig.poll ||
    !!videoConfig.mythFact ||
    !!videoConfig.versus ||
    !!videoConfig.priceReveal ||
    !!videoConfig.clientQuestion ||
    !!videoConfig.comeWithMe;

  if (
    !hasTalkingHead &&
    !hasNarrationAudio &&
    !hasTextFrames &&
    !hasOfferCard &&
    !hasOrganicConfig
  ) {
    throw new Error(
      `Video ${videoId}: Built config has no talking-head scene, no narrationAudio, no textFrames, no offerCard, and no organic-template config. The rendered video would have no content.`
    );
  }

  if (hasNarrationAudio && !hasBRoll) {
    throw new Error(
      `Video ${videoId}: AI voiceover config has narrationAudio but no b-roll scenes. The rendered video would have no visual content.`
    );
  }

  if ((hasTextFrames || hasOrganicConfig) && !hasBRoll) {
    throw new Error(
      `Video ${videoId}: text_only config has text content but no b-roll scenes. The rendered video would have no visual content.`
    );
  }

  // Update to rendering stage before starting Remotion Lambda
  await updateVideoStage(videoId, 'rendering');
  timings.renderStart = Date.now();

  // Refresh ECS credentials before each render (they're temporary)
  await loadRemotionCredentials(log);

  // Render video using Remotion Lambda
  const result = await renderAndWait(
    {
      videoConfig: videoConfig as never, // Type assertion for flexibility
      orientation: draftConfig.orientation || 'portrait',
      videoId,
    },
    onRenderProgress
  );

  timings.renderEnd = Date.now();

  // Check for errors
  if (result.errors && result.errors.length > 0) {
    throw new Error(`Render failed: ${result.errors.join(', ')}`);
  }

  if (!result.outputUrl) {
    throw new Error('Render completed but no output URL received');
  }

  // Copy video from Remotion bucket to org-assets bucket for CDN access
  log.info('Copying video to org-assets bucket...');
  const finalVideoUrl = await copyVideoToOrgAssets(
    result.outputUrl,
    organizationId,
    videoId
  );

  // Generate thumbnail from the rendered video
  log.info(`Generating thumbnail for video ${videoId}...`);
  const thumbnailUrl = await generateThumbnail(
    finalVideoUrl,
    organizationId,
    videoId
  );

  timings.jobCompleted = Date.now();

  // Log timing report for bottleneck analysis
  logTimings(videoId, timings);

  log.info(`Video ${videoId} completed: ${finalVideoUrl}`);

  // Mark as ready with CDN URL and thumbnail
  await markVideoReady(videoId, finalVideoUrl, { thumbnailUrl });

  // Product analytics: render attempt succeeded.
  if (isPostHogInitialized()) {
    trackOrgEvent(organizationId, 'video_render_completed', {
      organizationId,
      videoId,
      templateId: templateId ?? null,
      variationId: variationId ?? null,
      createdById: createdById ?? null,
      attempt: job.attemptsMade,
      durationMs: timings.jobCompleted - timings.jobStarted,
    });
  }

  // Send push notification to the user who created the video
  if (createdById) {
    sendPushNotification(db, {
      userId: createdById,
      title: 'Video ready!',
      body: 'Your video has finished processing.',
      data: { videoId, type: 'video_ready' },
    }).catch((err) => {
      log.warn('Failed to send push notification', {
        error: err instanceof Error ? err.message : String(err),
        videoId,
      });
    });
  }

  // Claire-on-WhatsApp renders have no client to poll — push the finished
  // video to the owner's conversation. Best-effort: a failed delivery must not
  // fail the (already-completed) render.
  if (whatsappDelivery && createdById) {
    await deliverFinishedVideoToWhatsapp({
      organizationId,
      createdById,
      conversationId: whatsappDelivery.conversationId,
      videoId,
      finalVideoUrl,
    }).catch((err) => {
      log.warn('Claire WhatsApp video delivery failed', {
        error: err instanceof Error ? err.message : String(err),
        videoId,
      });
    });
  }
}

interface VideoQueueHealth {
  waiting: number;
  prioritized: number;
  active: number;
  failed: number;
  readyDepth: number;
  oldestReadyJobAgeMs: number | null;
  oldestActiveJobAgeMs: number | null;
}

async function getOldestJobAgeMs(
  queue: Queue<VideoRenderJob>,
  types: JobType[]
): Promise<number | null> {
  const jobs = await queue.getJobs(types, 0, 99, true);
  const oldestTimestamp = jobs.reduce(
    (oldest, job) => Math.min(oldest, job.timestamp),
    Number.POSITIVE_INFINITY
  );
  return Number.isFinite(oldestTimestamp) ? Date.now() - oldestTimestamp : null;
}

async function collectVideoQueueHealth(
  queue: Queue<VideoRenderJob>
): Promise<VideoQueueHealth> {
  const counts = await queue.getJobCounts(
    'waiting',
    'prioritized',
    'active',
    'failed'
  );
  const waiting = counts.waiting ?? 0;
  const prioritized = counts.prioritized ?? 0;
  const active = counts.active ?? 0;
  const failed = counts.failed ?? 0;

  return {
    waiting,
    prioritized,
    active,
    failed,
    readyDepth: waiting + prioritized,
    oldestReadyJobAgeMs: await getOldestJobAgeMs(queue, [
      'waiting',
      'prioritized',
    ]),
    oldestActiveJobAgeMs: await getOldestJobAgeMs(queue, ['active']),
  };
}

function describeQueueHealthProblems(health: VideoQueueHealth): string[] {
  const reasons: string[] = [];
  if (health.readyDepth >= VIDEO_QUEUE_WARN_WAITING_DEPTH) {
    reasons.push(`ready_depth:${health.readyDepth}`);
  }
  if (
    health.oldestReadyJobAgeMs !== null &&
    health.oldestReadyJobAgeMs >= VIDEO_QUEUE_WARN_OLDEST_READY_JOB_AGE_MS
  ) {
    reasons.push(`oldest_ready_ms:${health.oldestReadyJobAgeMs}`);
  }
  if (
    health.oldestActiveJobAgeMs !== null &&
    health.oldestActiveJobAgeMs >= VIDEO_QUEUE_WARN_ACTIVE_JOB_AGE_MS
  ) {
    reasons.push(`oldest_active_ms:${health.oldestActiveJobAgeMs}`);
  }
  return reasons;
}

/**
 * BetterStack heartbeat ping plus queue-health monitoring.
 * Returns the interval handle for cleanup on shutdown.
 */
function startHeartbeat(queue: Queue<VideoRenderJob>): NodeJS.Timeout | null {
  const heartbeatUrl = process.env.BETTERSTACK_HEARTBEAT_URL;
  if (!heartbeatUrl) {
    log.info('BETTERSTACK_HEARTBEAT_URL not set, skipping heartbeat');
    return null;
  }

  const HEARTBEAT_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes
  let lastQueueHealthAlertKey: string | null = null;

  const ping = async () => {
    try {
      const health = await collectVideoQueueHealth(queue);
      const reasons = describeQueueHealthProblems(health);
      const alertKey = reasons.join('|') || null;

      log.info('Video worker heartbeat', {
        queue: VIDEO_RENDER_QUEUE,
        ...health,
        thresholds: {
          waitingDepth: VIDEO_QUEUE_WARN_WAITING_DEPTH,
          oldestReadyJobAgeMs: VIDEO_QUEUE_WARN_OLDEST_READY_JOB_AGE_MS,
          oldestActiveJobAgeMs: VIDEO_QUEUE_WARN_ACTIVE_JOB_AGE_MS,
        },
      });

      if (alertKey && alertKey !== lastQueueHealthAlertKey) {
        logWarning(
          'video-worker.queueHealth',
          'Video queue health threshold breached',
          {
            feature: 'video-worker',
            tags: { queue: VIDEO_RENDER_QUEUE },
            extra: { reasons, ...health },
          }
        );
      } else if (alertKey) {
        log.warn('Video queue health threshold still breached', {
          reasons,
          ...health,
        });
      } else if (lastQueueHealthAlertKey) {
        log.info('Video queue health recovered', { ...health });
      }

      lastQueueHealthAlertKey = alertKey;
    } catch (error) {
      logError('video-worker.queueHealthCheck', error, {
        feature: 'video-worker',
        extra: { queue: VIDEO_RENDER_QUEUE },
      });
    }

    await fetch(heartbeatUrl).catch((err) => {
      log.warn('Heartbeat ping failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
  };

  // Ping immediately on startup, then every 4 minutes
  void ping();
  const interval = setInterval(() => {
    void ping();
  }, HEARTBEAT_INTERVAL_MS);
  log.info('BetterStack heartbeat started (every 4min)');
  return interval;
}

/**
 * Initialize services and start the worker
 */
async function main(): Promise<void> {
  // Tune kernel TCP timeouts FIRST, before any DB/Redis socket is opened, so a
  // Fly-NAT-severed connection is reaped by the OS in ~tens of seconds instead
  // of hanging the pool indefinitely. No-op off Linux; never fatal.
  applyTcpResilienceTuning();

  // Initialize structured logger with Logtail
  initLogger({
    level:
      (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    logtailToken: process.env.LOGTAIL_TOKEN,
    logtailEndpoint: process.env.LOGTAIL_ENDPOINT,
    // APP_ENV is the DEPLOY environment (preview / staging / production);
    // NODE_ENV is the BUILD mode and is 'production' on every Fly deploy,
    // preview included. Reading NODE_ENV here filed every preview's logs
    // under `production`, which both polluted prod dashboards and made a
    // preview's own logs unfindable. `flyApp` (added in logger.ts) already
    // says WHICH preview; this says which environment it belongs to.
    environment: process.env.APP_ENV || process.env.NODE_ENV || 'development',
    serviceName: 'video-worker',
    pretty: process.env.NODE_ENV !== 'production',
  });
  log = createLogger('video-worker');

  // E2E Meta contract fake / recorder — installed before any BullMQ consumer is
  // registered, so no job can make a Graph call ahead of the interceptor.
  //
  // The worker needs this as much as the API does: chatbot delivery
  // (execute-flow → deliver-messages) and meta-sync both call Meta from HERE.
  // A stubbed API beside a live worker is worse than neither — half the traffic
  // escapes to real Meta and the failure reads as a product bug.
  // Share the fake's object graph across processes. The preview API runs on TWO
  // machines during the E2E window and the worker is a third; with the default
  // in-memory store a campaign created on one is invisible to the next request,
  // which the suite saw as a list that was empty, then held one, then three
  // duplicates of the same name. Redis is already up for BullMQ.
  //
  // Namespaced by stack, for the same reason BullMQ keys are: every preview
  // shares ONE Redis, so an un-namespaced hash let a concurrent PR's cleanup
  // delete this stack's campaigns and leave its own behind — visible over
  // Graph, but with no `meta_campaign_config` row in THIS stack's database.
  // See `fakeStoreKey` in packages/integrations/.../fake/store.ts.
  const metaContractStore =
    process.env.META_E2E_STUB === 'true'
      ? createRedisFakeStore(getRedis(), { namespace: getBullMqPrefix() })
      : undefined;
  const metaContractMode = installMetaContractInterceptor({
    store: metaContractStore,
  });
  if (metaContractMode) log.warn(metaContractMode);

  // Initialize Sentry for error tracking
  // Through observabilityEnv, as apps/api does, rather than raw process.env:
  // `environment` is a four-value union and NODE_ENV is not one of them ('test'
  // is the obvious miss), so the fallback could hand Sentry an environment it
  // does not accept. The env package validates and defaults it.
  initSentry({
    dsn: observabilityEnv.SENTRY_DSN,
    environment: observabilityEnv.SENTRY_ENVIRONMENT,
    release: observabilityEnv.SENTRY_RELEASE,
  });

  // Initialize PostHog so render lifecycle events (video_render_started/
  // completed/failed) reach product analytics. The render outcome lives here in
  // the worker, not the API, so without this the render success/failure rate is
  // unmeasurable. Flushed on shutdown below.
  initPostHog({
    apiKey: process.env.POSTHOG_API_KEY,
    host: process.env.POSTHOG_HOST,
  });

  // Dead-man's switch for PostHog telemetry liveness (distinct from the process
  // heartbeat below): pings Better Stack only while the PostHog client is live.
  startPostHogHeartbeat({
    service: 'worker',
    heartbeatUrl: process.env.BETTERSTACK_POSTHOG_HEARTBEAT_URL,
  });

  // Telemetry self-check: emits the same snapshot to Better Stack AND PostHog
  // every minute, so a dead forwarding path is detectable by absence instead of
  // being indistinguishable from "no errors happened".
  startTelemetryCanary({ service: 'video-worker' });

  log.info('Starting video worker...');

  // Debug self-test: fire a worker-side error on boot so the Sentry → PostHog
  // dual-send can be verified from the worker (which has no HTTP surface).
  // Enable with DEBUG_FIRE_STARTUP_ERROR=1; ignored in production.
  if (
    process.env.NODE_ENV !== 'production' &&
    process.env.DEBUG_FIRE_STARTUP_ERROR
  ) {
    log.warn(
      'DEBUG_FIRE_STARTUP_ERROR set — firing test error to Sentry + PostHog'
    );
    logError(
      'video-worker.debugStartupError',
      new Error('Test worker startup error (DEBUG_FIRE_STARTUP_ERROR)'),
      { feature: 'video-worker', tags: { source: 'debug-startup' } }
    );
  }

  // NOTE: env is validated at IMPORT time by `videoProcessingEnv` (top of this
  // file), not here. The old code `log.warn`ed on a missing Remotion target and
  // carried on — booting green and failing every render. A missing required var
  // is now a hard boot failure.

  // Initialize FFmpeg
  log.info('Initializing FFmpeg...');
  await initFFmpeg();

  // Initialize transcription service (auto-detects cloud vs local mode)
  // Cloud mode is used if OPENAI_API_KEY is set (5-10x faster)
  // Local mode uses whisper.cpp (fallback)
  log.info('Initializing transcription service...');
  const transcriptionConfig = createConfigFromEnv();
  await initTranscription(transcriptionConfig, true); // skipLocalInstall=true for Docker
  const transcriptionMode = getTranscriptionMode();
  if (!transcriptionMode) {
    // A null mode means transcription never initialized — captions would
    // silently fail on every job. Fail loud at boot rather than accept work.
    throw new Error(
      'Transcription service failed to initialize (mode is null) — refusing to accept jobs'
    );
  }
  log.info(`Transcription mode: ${transcriptionMode.toUpperCase()}`);

  // Initialize TTS (ElevenLabs) for AI voiceover generation
  log.info('Initializing TTS...');
  initTts({ elevenLabsApiKey: process.env.ELEVENLABS_API_KEY });
  if (!isTtsReady()) {
    // ai_voiceover jobs need TTS; booting "healthy" without it strands every
    // voiceover render. Exit loud so the missing ELEVENLABS_API_KEY is caught.
    throw new Error(
      'TTS failed to initialize (missing ELEVENLABS_API_KEY?) — refusing to accept jobs'
    );
  }
  log.info('TTS initialized: ready');

  // Load ECS task role credentials for Remotion SDK
  await loadRemotionCredentials(log);

  // Initialize Remotion Lambda
  log.info('Initializing Remotion Lambda...');
  initRemotionLambda({
    region: REMOTION_AWS_REGION,
    functionName: REMOTION_FUNCTION_NAME,
    serveUrl: REMOTION_SERVE_URL,
  });

  // Get Redis connection for BullMQ
  const redis = getRedis();
  const videoQueue = new Queue<VideoRenderJob>(VIDEO_RENDER_QUEUE, {
    connection: redis,
    prefix: getBullMqPrefix(),
  });

  // Start the liveness HTTP server FIRST so Fly's health check has something to
  // probe as soon as the machine boots. Reports unhealthy (→ Fly recycles the
  // machine) if the event loop wedges or the Redis connection isn't ready.
  const healthServer = startHealthServer(redis, log);

  log.info(`Starting with concurrency: ${VIDEO_WORKER_CONCURRENCY}`);

  // Create video render worker
  const videoWorker = new Worker<VideoRenderJob>(
    VIDEO_RENDER_QUEUE,
    async (job) => {
      try {
        await processVideoJob(job);
      } catch (error) {
        logError('video-worker.processJob', error, {
          feature: 'video-worker',
          extra: {
            jobId: job.id,
            videoId: job.data.videoId,
            organizationId: job.data.organizationId,
          },
        });

        // Store a generic user-facing message in the database in production,
        // but surface the raw error in development so the UI's failed-state
        // card shows what actually broke. The worker process never serves
        // an external API directly, so leaking the message here is fine —
        // it goes to the operator chat tile, not to the public.
        const userMessage =
          process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred while processing your video. Please try again.'
            : error instanceof Error
              ? error.message
              : String(error);
        await markVideoFailed(job.data.videoId, userMessage);

        // Product analytics: render attempt failed. `attempt` lets us separate
        // transient retries from final failures in the success-rate metric.
        if (isPostHogInitialized()) {
          trackOrgEvent(job.data.organizationId, 'video_render_failed', {
            organizationId: job.data.organizationId,
            videoId: job.data.videoId,
            templateId: job.data.templateId ?? null,
            variationId: job.data.variationId ?? null,
            createdById: job.data.createdById ?? null,
            attempt: job.attemptsMade,
            failureReason:
              error instanceof Error ? error.message : String(error),
          });
        }

        // Send push notification about failure
        if (job.data.createdById) {
          sendPushNotification(db, {
            userId: job.data.createdById,
            title: 'Video processing failed',
            body: 'There was an issue processing your video. Please try again.',
            data: { videoId: job.data.videoId, type: 'video_failed' },
          }).catch(() => {
            // Non-critical, don't block the error flow
          });
        }

        // Claire-on-WhatsApp: the owner has no polling UI, so push a failure
        // message so they're not left waiting in silence.
        if (job.data.whatsappDelivery && job.data.createdById) {
          queueClaireWhatsappOutbound({
            organizationId: job.data.organizationId,
            userId: job.data.createdById,
            conversationId: job.data.whatsappDelivery.conversationId,
            messages: [
              {
                kind: 'text',
                body: "Sorry, your video couldn't be rendered. You can ask me to try again or create a different one.",
              },
            ],
            recordAs: 'Notified the owner that video rendering failed.',
            dedupeKey: `video-failed:${job.data.videoId}`,
          }).catch((err) => {
            log.warn('Failed to enqueue Claire WhatsApp video failure notice', {
              videoId: job.data.videoId,
              error: err instanceof Error ? err.message : String(err),
            });
          });
        }

        // Re-throw to mark job as failed in BullMQ
        throw error;
      }
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: VIDEO_WORKER_CONCURRENCY, // Process multiple videos concurrently
      lockDuration: 600000, // 10 minute lock (videos can take a while)
      stalledInterval: 60000, // Check for stalled jobs every minute
    }
  );

  // Video worker event handlers
  videoWorker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });

  videoWorker.on('active', (job) => {
    log.info(`Job ${job.id} started`);
  });

  videoWorker.on('completed', (job) => {
    log.info(`Job ${job.id} completed`);
  });

  videoWorker.on('failed', async (job, error) => {
    logError('video-worker.jobFailed', error, {
      feature: 'video-worker',
      extra: {
        jobId: job?.id,
        videoId: job?.data.videoId,
        attemptsMade: job?.attemptsMade,
      },
    });

    // Terminal-failure detection. Two ways a job ends for good:
    //   1. It exhausted its configured retries (attemptsMade >= attempts).
    //   2. BullMQ gave up after too many STALLS — i.e. the worker process was
    //      killed mid-job (OOM/SIGKILL) so the in-catch `markVideoFailed` never
    //      ran, the lock expired, and the stalled-checker eventually fails the
    //      job. A stalled-out failure is terminal but its `attemptsMade` may be
    //      BELOW `attempts`, so the old `attemptsMade >= attempts` gate skipped
    //      it and left the row stranded in `processing` forever (the "video
    //      never renders, nothing surfaces" symptom). Catch it explicitly.
    // We deliberately do NOT re-assert on non-terminal attempts (1..n-1): those
    // WILL be retried, and writing `failed` here would race the retry's
    // `markVideoProcessing` and flip an actively-processing row to failed.
    const attempts = job?.opts.attempts || 3;
    const isFinalAttempt = !!job && job.attemptsMade >= attempts;
    const isStalledTerminal = /stalled/i.test(error?.message || '');
    if (job && (isFinalAttempt || isStalledTerminal)) {
      log.warn(
        `Job ${job.id} failed terminally (attemptsMade=${job.attemptsMade}, ` +
          `stalled=${isStalledTerminal}), finalizing`
      );

      // Re-assert terminal DB status here. The in-catch markVideoFailed runs
      // first for in-band throws, but a process-killed (stalled) job never
      // reached it — this is the ONLY place that row gets marked `failed`, so
      // it must run on the stalled-terminal path too. markVideoFailed is an
      // idempotent status write, so a redundant call on the final-attempt path
      // is harmless.
      try {
        await markVideoFailed(
          job.data.videoId,
          'An unexpected error occurred while processing your video. Please try again.'
        );
      } catch (markError) {
        logError('video-worker.jobFailed.markVideoFailed', markError, {
          feature: 'video-worker',
          extra: { jobId: job.id, videoId: job.data.videoId },
        });
      }

      try {
        await moveToDeadLetterQueue({
          id: job.id || job.data.videoId,
          data: job.data,
          failedReason: error.message,
          attemptsMade: job.attemptsMade,
        });
        log.info(`Job ${job.id} moved to dead letter queue`);
      } catch (dlqError) {
        logError('video-worker.moveToDeadLetterQueue', dlqError, {
          feature: 'video-worker',
          extra: { jobId: job.id, videoId: job.data.videoId },
        });
      }
    }
  });

  videoWorker.on('error', (error) => {
    if (
      error instanceof Error &&
      error.message.includes('max requests limit exceeded')
    ) {
      log.warn('Redis request limit exceeded — upgrade the Upstash plan');
      return;
    }
    // Transient Redis connection blips self-heal via retryStrategy — warn
    // instead of paging Sentry (ENG-51).
    if (isTransientRedisError(error)) {
      log.warn(
        `Transient Redis error (auto-recovering): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }
    logError('video-worker.workerError', error, { feature: 'video-worker' });
  });

  // Create asset analysis worker
  log.info('Starting asset analysis worker...');
  const assetAnalysisWorker = createAssetAnalysisWorker();

  // Create asset thumbnail worker
  log.info('Starting asset thumbnail worker...');
  const assetThumbnailWorker = createAssetThumbnailWorker();

  // Create asset probe worker
  const assetProbeWorker = createAssetProbeWorker();

  // Create asset transcode worker
  const assetTranscodeWorker = createAssetTranscodeWorker();

  // Create graphic generation worker (consumes the 'graphic-generate' queue
  // that the content-batch seeder + socials graphic flow enqueue to).
  log.info('Starting graphic generate worker...');
  const graphicGenerateWorker = createGraphicGenerateWorker();

  // Create meta-sync worker (consumes the 'meta-sync' queue that the
  // meta-campaigns/sync-all endpoint enqueues to, moving the slow Meta Graph
  // API sync off the API request path).
  log.info('Starting meta-sync worker...');
  const metaSyncWorker = createMetaSyncWorker();

  // microsite-domain worker: custom-domain verification polling and the
  // domain_changed fan-out. Without it the poller is dormant — jobs enqueue and
  // never run, and a tenant sits on "pending DNS" forever while everything
  // reports healthy.
  log.info('Starting microsite-domain worker...');
  const micrositeDomainWorker = createMicrositeDomainWorker();

  // meta-campaign-duplicate worker (the meta-campaigns/:id/duplicate endpoint
  // enqueues to it, moving the long Meta /copies sequence off the request path).
  log.info('Starting meta-campaign-duplicate worker...');
  const metaCampaignDuplicateWorker = createMetaCampaignDuplicateWorker();

  // Durable monthly content planning. The API only prepares the row and
  // enqueues this job; all slow LLM planning and render fan-out lives here.
  log.info('Starting content-batch-generate worker...');
  const contentBatchGenerateWorker = createContentBatchGenerateWorker();

  // stock-match worker (service create/update enqueues to it, running the
  // once-per-service stock-clip matcher's LLM call off the request path).
  log.info('Starting stock-match worker...');
  const stockMatchWorker = createStockMatchWorker();

  // Start BetterStack heartbeat
  const heartbeatInterval = startHeartbeat(videoQueue);

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down gracefully...`);

    try {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      await healthServer.close();
      await Promise.all([
        videoWorker.close(),
        closeAssetAnalysisWorker(assetAnalysisWorker),
        closeAssetThumbnailWorker(assetThumbnailWorker),
        closeAssetProbeWorker(assetProbeWorker),
        closeAssetTranscodeWorker(assetTranscodeWorker),
        closeGraphicGenerateWorker(graphicGenerateWorker),
        closeMetaSyncWorker(metaSyncWorker),
        closeMicrositeDomainWorker(micrositeDomainWorker),
        closeMetaCampaignDuplicateWorker(metaCampaignDuplicateWorker),
        closeContentBatchGenerateWorker(contentBatchGenerateWorker),
        closeStockMatchWorker(stockMatchWorker),
        videoQueue.close(),
      ]);
      await disconnect();
      await Promise.all([flushLogs(), shutdownPostHog()]);
      log.info('All workers shut down successfully');
      process.exit(0);
    } catch (error) {
      log.error('Error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      await flushLogs();
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  log.info('All workers started successfully');
}

/**
 * A dropped Neon/Fly pooled connection surfaces from postgres.js as an ASYNC
 * error fired from a `setImmediate` write callback — outside any query
 * try/catch — as either a transient connection code (`CONNECTION_CLOSED`/
 * `ECONNRESET`/…) or a bare `TypeError: Cannot read properties of null
 * (reading 'write')` from postgres.js `connection.js` (`nextWrite`). These are
 * recoverable: the pool reconnects and `withDbRetry` covers the query layer.
 * Mirrors the api's handler (apps/api/src/main.ts). Without it a single TCP
 * blip crashes the worker — and RLS makes drops more frequent (it runs the
 * app_system + role pools), which intermittently failed render jobs (the
 * monthly-batch image-generation e2e).
 */
function isRecoverableDbConnectionError(error: unknown): boolean {
  if (isTransientDbError(error)) return true;
  if (error instanceof Error) {
    const stack = error.stack ?? '';
    const fromPostgresInternals =
      /node_modules[\\/].*postgres[\\/]/.test(stack) &&
      /connection\.js|nextWrite/.test(stack);
    const nullSocketAccess =
      /Cannot read properties of null \(reading '(write|read|readable|writable|once|on|end)'\)/.test(
        error.message
      );
    if (fromPostgresInternals && nullSocketAccess) return true;
  }
  return false;
}

process.on('uncaughtException', (error) => {
  const l = log || createLogger('video-worker');
  if (isRecoverableDbConnectionError(error)) {
    l.warn(
      `Recoverable DB connection error — surviving, pool will reconnect: ${error.message}`,
      { stack: error.stack, name: error.name }
    );
    return;
  }
  l.fatal(`Uncaught exception: ${error.message}`, {
    stack: error.stack,
    name: error.name,
  });
  void Promise.allSettled([flushLogs(), flushSentry(2000)]).finally(() =>
    process.exit(1)
  );
});
process.on('unhandledRejection', (reason) => {
  const l = log || createLogger('video-worker');
  const message = reason instanceof Error ? reason.message : String(reason);
  if (isRecoverableDbConnectionError(reason)) {
    l.warn(
      `Recoverable DB connection error (unhandled rejection) — surviving: ${message}`,
      { stack: reason instanceof Error ? reason.stack : undefined }
    );
    return;
  }
  l.fatal(`Unhandled rejection: ${message}`, {
    stack: reason instanceof Error ? reason.stack : undefined,
  });
  void Promise.allSettled([flushLogs(), flushSentry(2000)]).finally(() =>
    process.exit(1)
  );
});

// Run the worker
main().catch(async (error) => {
  const fatalLog = log || createLogger('video-worker');
  fatalLog.fatal('Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  await flushLogs();
  process.exit(1);
});
