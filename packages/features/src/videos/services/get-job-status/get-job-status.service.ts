import { type VideoProcessingStage, video } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import type { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { getJobQueue, videoRenderQueue } from '../../../jobs/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetJobStatusInput,
  getJobStatusSchema,
} from './get-job-status.schema.js';

/** The ONE video-render queue instance (name + options from the declaration). */
function getVideoQueue(): Queue {
  return getJobQueue(videoRenderQueue);
}

/**
 * Job state from BullMQ
 */
export type JobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed'
  | 'prioritized'
  | 'waiting-children'
  | 'unknown';

/**
 * Detailed job status response
 */
export interface VideoJobStatus {
  /** Job ID (same as video ID) */
  jobId: string;
  /** BullMQ job state */
  state: JobState;
  /** Progress percentage (0-100) */
  progress: number;
  /** Current processing stage from database */
  processingStage: VideoProcessingStage | null;
  /** Timestamp when current stage started */
  stageStartedAt: string | null;
  /** Reason for failure (if failed) */
  failedReason: string | null;
  /** Position in queue (if waiting, 1-indexed) */
  queuePosition: number | null;
  /** Timestamp when job started processing */
  processedOn: number | null;
  /** Timestamp when job finished */
  finishedOn: number | null;
}

/**
 * Internal implementation of get job status
 */
const getJobStatusImpl = async (
  db: DbConnection,
  input: GetJobStatusInput
): Promise<Result<VideoJobStatus>> => {
  // Validate input
  const parsed = getJobStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { videoId } = parsed.data;

  // Get video from database to get processing stage
  const [videoRecord] = await db
    .select({
      id: video.id,
      status: video.status,
      processingStage: video.processingStage,
      stageStartedAt: video.stageStartedAt,
      progress: video.progress,
      errorMessage: video.errorMessage,
    })
    .from(video)
    .where(eq(video.id, videoId))
    .limit(1);

  if (!videoRecord) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found', { videoId })
    );
  }

  // Get job from BullMQ queue
  const queue = getVideoQueue();
  const job = await queue.getJob(videoId);

  // If no job in queue, return status from database only
  if (!job) {
    return ok({
      jobId: videoId,
      state: mapVideoStatusToJobState(videoRecord.status),
      progress: videoRecord.progress ?? 0,
      processingStage: videoRecord.processingStage,
      stageStartedAt: videoRecord.stageStartedAt?.toISOString() ?? null,
      failedReason: videoRecord.errorMessage,
      queuePosition: null,
      processedOn: null,
      finishedOn: null,
    });
  }

  // Get job state and position
  const state = await job.getState();
  const progress = typeof job.progress === 'number' ? job.progress : 0;

  // Calculate queue position if waiting
  let queuePosition: number | null = null;
  if (state === 'waiting') {
    const waitingJobs = await queue.getWaiting(0, 1000);
    const position = waitingJobs.findIndex((j) => j.id === videoId);
    queuePosition = position >= 0 ? position + 1 : null;
  }

  return ok({
    jobId: videoId,
    state: state as JobState,
    progress,
    processingStage: videoRecord.processingStage,
    stageStartedAt: videoRecord.stageStartedAt?.toISOString() ?? null,
    failedReason: job.failedReason ?? videoRecord.errorMessage,
    queuePosition,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
  });
};

/**
 * Map video status to job state for when job is not in queue
 */
function mapVideoStatusToJobState(status: string | null): JobState {
  switch (status) {
    case 'queued':
      return 'waiting';
    case 'processing':
      return 'active';
    case 'ready':
      return 'completed';
    case 'failed':
      return 'failed';
    default:
      return 'unknown';
  }
}

/**
 * Get detailed job status for a video
 * Includes queue position, processing stage, and timestamps
 *
 * @param db - Database connection
 * @param input - Video ID to get status for
 * @returns Result with job status or error
 */
export const getVideoJobStatus = (db: DbConnection, input: GetJobStatusInput) =>
  trackedResult('videos.getVideoJobStatus', () => getJobStatusImpl(db, input), {
    properties: { videoId: input.videoId },
    internalErrorsOnly: true,
  });

/**
 * Result type for getVideoJobStatus
 */
export type GetVideoJobStatusResult = Awaited<
  ReturnType<typeof getVideoJobStatus>
>;
