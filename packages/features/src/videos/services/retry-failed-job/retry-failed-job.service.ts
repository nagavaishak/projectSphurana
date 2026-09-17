import {
  type Database,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type VideoRenderJobInput,
  enqueueJob,
  getJobQueue,
  videoRenderJob,
  videoRenderQueue,
} from '../../../jobs/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getResolvedTheme } from '../get-resolved-theme/index.js';
import { validateBRollAssetsForRender } from '../queue-video-export/queue-video-export.service.js';
import {
  type RetryFailedJobInput,
  retryFailedJobSchema,
} from './retry-failed-job.schema.js';

/**
 * Internal implementation of retry failed job.
 *
 * This path used to declare its OWN copy of the video-render payload (7 of the
 * 11 fields — no `theme`, no `synthesisOverrides`) and build its OWN
 * `Queue('video-render')` with `attempts: 1`. So a manually-retried branded
 * render succeeded, got one shot instead of three, and came out with the wrong
 * theme and none of the frozen content. It now uses the ONE payload
 * declaration and the ONE queue instance.
 */
const retryFailedJobImpl = async (
  db: DbConnection,
  input: RetryFailedJobInput
): Promise<Result<typeof updatedVideo>> => {
  // Validate input
  const parsed = retryFailedJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId } = parsed.data;

  // Get the video from database
  const [videoRecord] = await db
    .select()
    .from(video)
    .where(eq(video.id, videoId))
    .limit(1);

  if (!videoRecord) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', { videoId })
    );
  }

  // Verify video is in failed status
  if (videoRecord.status !== 'failed') {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `Can only retry failed videos. Current status: ${videoRecord.status}`,
        { currentStatus: videoRecord.status }
      )
    );
  }

  if (!videoRecord.draftConfig) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Video has no draft configuration',
        { videoId }
      )
    );
  }

  // v1 retries build their render payload in the same worker path as a normal
  // export, so a b-roll ID whose asset has since been deleted re-enqueues an
  // impossible job: the worker silently drops the missing asset and the render
  // fails again, burning the full retry budget. Reject it here instead.
  //
  // Deliberately narrower than the enqueue path: this does NOT re-run
  // `isDraftConfigComplete`. That structural gate has been tightened several
  // times (see its comments), so failed rows persisted under an older, more
  // permissive version would stop being retryable at all — turning "tried and
  // failed" into "can't try" for configs the worker may still render via its
  // own defaults. Only unresolvable b-roll, which is unrecoverable by
  // definition, blocks a retry.
  //
  // v2 compiles from its template document and has its own slot gate.
  const schemaVersion = videoRecord.schemaVersion === 2 ? 2 : 1;
  if (schemaVersion === 1) {
    const bRollAssetError = await validateBRollAssetsForRender(
      db,
      videoRecord.organizationId,
      videoRecord.draftConfig?.bRollClips
    );
    if (bRollAssetError) {
      return err(
        new FeatureError(bRollAssetError.code, bRollAssetError.message, {
          videoId,
          ...bRollAssetError.details,
        })
      );
    }
  }

  // Remove the old failed job if it exists
  const queue = getJobQueue(videoRenderQueue);
  const existingJob = await queue.getJob(videoId);
  if (existingJob) {
    await existingJob.remove();
  }

  // Update video status to queued
  const [updatedVideo] = await db
    .update(video)
    .set({
      status: 'queued',
      progress: 0,
      errorMessage: null,
      processingStage: null,
      stageStartedAt: null,
    })
    .where(eq(video.id, videoId))
    .returning();

  // v2 path: preserve schemaVersion and reuse compiled renderDoc when available.

  // Replay the theme the original render used. The synthesizer resolves it from
  // the org's brand kit + the video's persisted theme overrides; re-resolving it
  // the same way is what makes the retry produce the SAME branded video instead
  // of an unthemed one. (`getResolvedTheme` needs the root Database handle, not
  // the org-scoped tx — same as the synthesizer.)
  const synthesisOverrides = videoRecord.synthesisOverrides ?? null;
  let theme: VideoRenderJobInput['theme'] = null;
  if (schemaVersion === 2) {
    const themeResult = await getResolvedTheme(db as Database, {
      organizationId: videoRecord.organizationId,
      themeOverrides: synthesisOverrides?.themeOverrides,
    });
    // A failure here is not worth blocking the retry: the worker's compiler
    // re-resolves the theme when it is absent. Carry it when we have it.
    theme = themeResult.success ? themeResult.data : null;
  }

  const jobPayload: VideoRenderJobInput = {
    videoId,
    organizationId: videoRecord.organizationId,
    draftConfig: videoRecord.draftConfig,
    variationId: videoRecord.variationId ?? null,
    templateId: videoRecord.templateId ?? null,
    createdById: videoRecord.createdById ?? null,
    schemaVersion,
    templateDocId:
      schemaVersion === 2 ? (videoRecord.variationId ?? 'educational-1') : null,
    skipCompile: schemaVersion === 2 && videoRecord.renderDoc != null,
    theme,
    synthesisOverrides,
    whatsappDelivery: null,
  };

  await enqueueJob(videoRenderJob, jobPayload, { jobId: videoId });

  return ok(updatedVideo);
};

/**
 * Retry a failed video rendering job
 * Removes the old failed job and creates a new one
 * Only works for videos in 'failed' status
 *
 * @param db - Database connection
 * @param input - Video ID to retry
 * @returns Result with updated video or error
 */
export const retryFailedJob = (db: DbConnection, input: RetryFailedJobInput) =>
  trackedResult(
    'videos.retryFailedJob',
    () => withOrgScope((tx) => retryFailedJobImpl(tx, input), { db }),
    { properties: { videoId: input.videoId } }
  );

/**
 * Result type for retryFailedJob
 */
export type RetryFailedJobResult = Awaited<ReturnType<typeof retryFailedJob>>;
