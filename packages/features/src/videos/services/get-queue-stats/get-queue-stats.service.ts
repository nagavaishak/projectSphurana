import { trackedResult } from '@borradh-workspace/observability';
import type { Queue } from 'bullmq';
import { getJobQueue, videoRenderQueue } from '../../../jobs/index.js';
import { type Result, ok } from '../../../shared/index.js';

/** The ONE video-render queue instance (name + options from the declaration). */
function getVideoQueue(): Queue {
  return getJobQueue(videoRenderQueue);
}

/**
 * Queue statistics response
 */
export interface QueueStats {
  /** Number of jobs waiting to be processed */
  waiting: number;
  /** Number of jobs currently being processed */
  active: number;
  /** Number of completed jobs (from retained jobs) */
  completed: number;
  /** Number of failed jobs (from retained jobs) */
  failed: number;
  /** Number of delayed jobs */
  delayed: number;
  /** Whether the queue is paused */
  paused: boolean;
  /** Average processing time in milliseconds (from recent completed jobs) */
  avgProcessingTimeMs: number | null;
}

/**
 * Internal implementation of get queue stats
 */
const getQueueStatsImpl = async (): Promise<Result<QueueStats>> => {
  const queue = getVideoQueue();

  // Get job counts
  const [waiting, active, completed, failed, delayed, paused] =
    await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused(),
    ]);

  // Calculate average processing time from recent completed jobs
  let avgProcessingTimeMs: number | null = null;
  try {
    const completedJobs = await queue.getCompleted(0, 50);
    if (completedJobs.length > 0) {
      const processingTimes = completedJobs
        .filter((job) => job.processedOn && job.finishedOn)
        .map((job) => (job.finishedOn ?? 0) - (job.processedOn ?? 0));

      if (processingTimes.length > 0) {
        avgProcessingTimeMs = Math.round(
          processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
        );
      }
    }
  } catch {
    // Ignore errors calculating average time
  }

  return ok({
    waiting,
    active,
    completed,
    failed,
    delayed,
    paused,
    avgProcessingTimeMs,
  });
};

/**
 * Get video render queue statistics
 * Returns counts of jobs in various states and average processing time
 *
 * @returns Result with queue statistics
 */
export const getQueueStats = () =>
  trackedResult('videos.getQueueStats', () => getQueueStatsImpl(), {
    internalErrorsOnly: true,
  });

/**
 * Result type for getQueueStats
 */
export type GetQueueStatsResult = Awaited<ReturnType<typeof getQueueStats>>;
