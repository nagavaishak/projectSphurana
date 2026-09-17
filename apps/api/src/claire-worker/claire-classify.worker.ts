import { db, withSystemScope } from '@borradh-workspace/database';
import {
  CLAIRE_CLASSIFY_QUEUE,
  type ClaireClassifyJobPayload,
  processClaireClassifyJob,
} from '@borradh-workspace/features/claire';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

const logger = createLogger('ClaireClassifyWorker');

/**
 * Create and return the BullMQ worker for the claire-classify queue.
 * Concurrency 2 — classification calls GPT-4o, keep the parallel cost bounded.
 */
export function createClaireClassifyWorker(): Worker {
  const worker = new Worker<ClaireClassifyJobPayload>(
    CLAIRE_CLASSIFY_QUEUE,
    async (job: Job<ClaireClassifyJobPayload>) => {
      logger.info('Processing claire classify job', {
        jobId: job.id,
        reason: job.data.reason,
        organizationId: job.data.organizationId,
      });
      await withSystemScope(
        (conn) => processClaireClassifyJob(conn, job.data),
        { db }
      );
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      // Classification can make two sequential model requests (classification
      // plus service selection) before persisting the profile. The 30s
      // BullMQ default allowed its Redis lock to expire during a slow run;
      // when a failed attempt was then scheduled for exponential backoff,
      // BullMQ rejected moveToDelayed with a lock mismatch. Keep this worker's
      // lock aligned with other long-running AI workers so a valid owner has
      // enough time to renew it rather than racing stalled-job recovery.
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    logger.debug('Claire classify job completed', {
      jobId: job.id,
      organizationId: job.data.organizationId,
    });
  });

  worker.on('failed', (job, error) => {
    logError('claire.classifyWorker.jobFailed', error, {
      feature: 'claire',
      extra: {
        jobId: job?.id,
        organizationId: job?.data?.organizationId,
        reason: job?.data?.reason,
        attemptsMade: job?.attemptsMade,
      },
    });
  });

  worker.on('stalled', (jobId) => {
    // A stalled job can be retried and therefore processed at least once more.
    // Surface it with the job id so a future lock issue is diagnosable before
    // it degrades into an opaque failed-state transition.
    logError(
      'claire.classifyWorker.jobStalled',
      new Error('Claire classify job stalled and will be recovered'),
      { feature: 'claire', extra: { jobId } }
    );
  });

  worker.on('error', (error) => {
    // Transient Upstash blips self-heal; warn instead of paging Sentry (API-58).
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('claire.classifyWorker.error', error, { feature: 'claire' });
  });

  return worker;
}
