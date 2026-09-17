import {
  type AwsRegion,
  type RenderMediaOnLambdaOutput,
  getRenderProgress,
  renderMediaOnLambda,
} from '@remotion/lambda-client';
import type { Orientation } from '../ffmpeg/types.js';
// VideoConfig is used by consumers of this service
import type {
  OrientationConfig,
  RemotionLambdaConfig,
  RenderOptions,
  RenderProgress,
  RenderResult,
} from './types.js';

let config: RemotionLambdaConfig | null = null;

/**
 * Initialize the Remotion Lambda service.
 *
 * @param lambdaConfig - Configuration for Remotion Lambda
 */
export function initRemotionLambda(lambdaConfig: RemotionLambdaConfig): void {
  config = lambdaConfig;
}

/**
 * Check if Remotion Lambda is initialized
 */
export function isRemotionLambdaInitialized(): boolean {
  return config !== null;
}

/**
 * Get the current Remotion Lambda configuration
 */
export function getRemotionLambdaConfig(): RemotionLambdaConfig | null {
  return config;
}

/**
 * Get orientation configuration (dimensions and composition ID)
 */
function getOrientationConfig(orientation: Orientation): OrientationConfig {
  const configs: Record<Orientation, OrientationConfig> = {
    portrait: {
      width: 1080,
      height: 1920,
      compositionId: 'PortraitVideo',
    },
    landscape: {
      width: 1920,
      height: 1080,
      compositionId: 'LandscapeVideo',
    },
    square: {
      width: 1080,
      height: 1080,
      compositionId: 'SquareVideo',
    },
  };

  return configs[orientation];
}

/**
 * Start rendering a video on Lambda.
 *
 * @param options - Render options including video config and orientation
 * @returns Render result with render ID and bucket info
 */
export async function startRender(
  options: RenderOptions,
  compositionIdOverride?: string
): Promise<RenderResult> {
  if (!config) {
    throw new Error(
      'Remotion Lambda not initialized. Call initRemotionLambda first.'
    );
  }

  const { videoConfig, orientation, videoId, timeoutMs } = options;
  const { compositionId: defaultCompositionId } =
    getOrientationConfig(orientation);
  const compositionId = compositionIdOverride ?? defaultCompositionId;

  const result: RenderMediaOnLambdaOutput = await renderMediaOnLambda({
    region: config.region as AwsRegion,
    functionName: config.functionName,
    serveUrl: config.serveUrl,
    composition: compositionId,
    inputProps: videoConfig as unknown as Record<string, unknown>,
    codec: 'h264',
    imageFormat: 'jpeg',
    // Allow Lambda to retry a failed frame chunk a couple of times before
    // failing the whole render — a single transient chunk failure shouldn't
    // sink a 10-minute job.
    maxRetries: 3,
    privacy: 'private',
    outName: `${videoId}.mp4`,
    // Performance optimizations - higher value = fewer concurrent Lambdas
    framesPerLambda: 20,
    timeoutInMilliseconds: timeoutMs ?? 600000, // 10 minutes default
    // Video encoding settings
    videoBitrate: '4M',
    encodingMaxRate: '6M',
    encodingBufferSize: '8M',
    x264Preset: 'veryfast',
  });

  return {
    renderId: result.renderId,
    bucketName: result.bucketName,
    outputUrl: '', // Will be available after render completes
  };
}

/**
 * Get the progress of an ongoing render.
 *
 * @param renderId - The render ID returned from startRender
 * @param bucketName - The S3 bucket name
 * @returns Render progress information
 */
export async function checkRenderProgress(
  renderId: string,
  bucketName: string
): Promise<RenderProgress> {
  if (!config) {
    throw new Error(
      'Remotion Lambda not initialized. Call initRemotionLambda first.'
    );
  }

  const progress = await getRenderProgress({
    renderId,
    bucketName,
    functionName: config.functionName,
    region: config.region as AwsRegion,
  });

  if (progress.fatalErrorEncountered) {
    return {
      progress: 0,
      isComplete: true,
      errors: progress.errors.map((e) => e.message),
    };
  }

  if (progress.done) {
    return {
      progress: 1,
      isComplete: true,
      outputUrl: progress.outputFile ?? undefined,
    };
  }

  return {
    progress: progress.overallProgress,
    isComplete: false,
  };
}

/**
 * Wait for a render to complete, polling at the specified interval.
 *
 * @param renderId - The render ID
 * @param bucketName - The S3 bucket name
 * @param pollIntervalMs - Polling interval in milliseconds (default: 2000)
 * @param onProgress - Optional callback for progress updates
 * @param maxWallClockMs - Hard cap on total polling time (default: 20 minutes)
 * @returns Final render progress with output URL
 */
export async function waitForRenderCompletion(
  renderId: string,
  bucketName: string,
  pollIntervalMs = 2000,
  onProgress?: (progress: RenderProgress) => void,
  maxWallClockMs = 20 * 60 * 1000
): Promise<RenderProgress> {
  const startedAt = Date.now();
  // Consecutive transient failures of the progress check. A render that is
  // genuinely progressing shouldn't fail the check repeatedly — if it does, the
  // render is wedged and we bail rather than poll forever.
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;

  for (;;) {
    if (Date.now() - startedAt > maxWallClockMs) {
      throw new Error(
        `Render ${renderId} did not complete within ${Math.round(
          maxWallClockMs / 1000
        )}s — aborting poll`
      );
    }

    let progress: RenderProgress;
    try {
      progress = await checkRenderProgress(renderId, bucketName);
      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(
          `Render ${renderId} progress check failed ${consecutiveErrors} times in a row: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (onProgress) {
      onProgress(progress);
    }

    if (progress.isComplete) {
      return progress;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Render a video and wait for completion.
 * This is a convenience function that combines startRender and waitForRenderCompletion.
 *
 * @param options - Render options
 * @param onProgress - Optional callback for progress updates
 * @returns Final render progress with output URL
 */
export async function renderAndWait(
  options: RenderOptions,
  onProgress?: (progress: RenderProgress) => void,
  compositionIdOverride?: string
): Promise<RenderProgress> {
  const result = await startRender(options, compositionIdOverride);
  return waitForRenderCompletion(
    result.renderId,
    result.bucketName,
    5000, // 5 seconds to avoid rate limiting
    onProgress
  );
}
type TemplateRenderDoc = {
  videoId: string;
  orientation: 'portrait' | 'landscape' | 'square';
};

export const templateRendererCompositionIdForOrientation = (
  orientation: TemplateRenderDoc['orientation']
): string => {
  switch (orientation) {
    case 'portrait':
      return 'TemplateRendererPortrait';
    case 'landscape':
      return 'TemplateRendererLandscape';
    case 'square':
      return 'TemplateRendererSquare';
    default:
      return 'TemplateRendererPortrait';
  }
};

export async function renderAndWaitV2(
  // No `& Record<string, unknown>`: an interface carries no implicit index
  // signature, so that intersection rejected every concrete RenderDoc a caller
  // actually holds — and it bought nothing, since the body casts to `never`
  // before handing the doc to Lambda.
  renderDoc: TemplateRenderDoc,
  onProgress?: (progress: RenderProgress) => void,
  videoId?: string
): Promise<RenderProgress> {
  const compositionId = templateRendererCompositionIdForOrientation(
    renderDoc.orientation
  );
  return renderAndWait(
    {
      videoConfig: renderDoc as never,
      orientation: renderDoc.orientation,
      videoId: videoId ?? renderDoc.videoId,
    },
    onProgress,
    compositionId
  );
}
