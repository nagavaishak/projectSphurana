import { db, withSystemScope } from '@borradh-workspace/database';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import {
  VOICE_INGEST_QUEUE,
  type VoiceIngestJobPayload,
  runVoiceIngest,
} from '@borradh-workspace/features/voice-cloning';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

/**
 * Ingest failures that are expected and org-side — the Meta page was deleted
 * (NOT_FOUND) or Meta returned an expected user/recipient state
 * (EXTERNAL_SERVICE_ERROR from fetchPageMessages). These are logged at warn and
 * the job is completed, so they never reach the `failed` handler / Sentry.
 * Every other code is a genuine failure and is thrown so BullMQ retries and
 * Sentry records it.
 */
const BENIGN_INGEST_ERROR_CODES: readonly string[] = [
  ErrorCodes.NOT_FOUND,
  ErrorCodes.EXTERNAL_SERVICE_ERROR,
];

const logger = createLogger('VoiceIngestWorker');

/**
 * Create and return the BullMQ worker for the voice-ingest queue.
 */
export function createVoiceIngestWorker(): Worker {
  const worker = new Worker<VoiceIngestJobPayload>(
    VOICE_INGEST_QUEUE,
    async (job: Job<VoiceIngestJobPayload>) => {
      logger.info('Processing voice ingest job', {
        jobId: job.id,
        organizationId: job.data.organizationId,
        metaAdsPageId: job.data.metaAdsPageId,
        triggerReason: job.data.triggerReason,
      });

      const result = await withSystemScope(
        (conn) =>
          runVoiceIngest(conn, {
            organizationId: job.data.organizationId,
            metaAdsPageId: job.data.metaAdsPageId,
            triggerReason: job.data.triggerReason,
          }),
        { db }
      );

      if (!result.success) {
        if (BENIGN_INGEST_ERROR_CODES.includes(result.error.code)) {
          // Expected org-side condition (deleted page / expected Meta state).
          // Complete the job quietly — throwing here would page Sentry via the
          // `failed` handler for a non-actionable state.
          logger.warn('Voice ingest skipped (expected condition)', {
            jobId: job.id,
            organizationId: job.data.organizationId,
            metaAdsPageId: job.data.metaAdsPageId,
            errorCode: result.error.code,
            errorMessage: result.error.message,
          });
          return;
        }
        logger.error('Voice ingest pipeline failed', {
          jobId: job.id,
          organizationId: job.data.organizationId,
          metaAdsPageId: job.data.metaAdsPageId,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        });
        throw new Error(
          `Voice ingest failed: ${result.error.code} — ${result.error.message}`
        );
      }

      logger.info('Voice ingest pipeline succeeded', {
        jobId: job.id,
        organizationId: job.data.organizationId,
        messagesFetched: result.data.messagesFetched,
        messagesEmbedded: result.data.messagesEmbedded,
        styleProfileGenerated: result.data.styleProfileGenerated,
      });
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 2,
    }
  );

  worker.on('completed', (job) => {
    logger.info('Voice ingest job completed', {
      jobId: job.id,
      organizationId: job.data.organizationId,
    });
  });

  worker.on('failed', (job, error) => {
    logError('voiceCloning.ingestWorker.jobFailed', error, {
      feature: 'voice-cloning',
      extra: {
        jobId: job?.id,
        organizationId: job?.data?.organizationId,
        metaAdsPageId: job?.data?.metaAdsPageId,
        attemptsMade: job?.attemptsMade,
      },
    });
  });

  worker.on('error', (error) => {
    // Transient Upstash blips self-heal; warn instead of paging Sentry (API-58).
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('voiceCloning.ingestWorker.error', error, {
      feature: 'voice-cloning',
    });
  });

  return worker;
}
