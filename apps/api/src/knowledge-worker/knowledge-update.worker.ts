import {
  KNOWLEDGE_UPDATE_QUEUE,
  type KnowledgeUpdateJobPayload,
  processKnowledgeUpdateJob,
} from '@borradh-workspace/features/assistant';
import {
  isTerminalFailure,
  moveToDeadLetter,
} from '@borradh-workspace/features/shared/queue';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

const logger = createLogger('KnowledgeUpdateWorker');

/**
 * Create and return the BullMQ worker for the knowledge-update queue.
 * Concurrency of 3 to avoid overloading the DB or OpenAI.
 */
export function createKnowledgeUpdateWorker(): Worker {
  const worker = new Worker<KnowledgeUpdateJobPayload>(
    KNOWLEDGE_UPDATE_QUEUE,
    async (job: Job<KnowledgeUpdateJobPayload>) => {
      logger.info('Processing knowledge update job', {
        jobId: job.id,
        type: job.data.type,
        orgId: job.data.orgId,
      });

      await processKnowledgeUpdateJob(job.data);
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 3,
    }
  );

  worker.on('completed', (job) => {
    logger.debug('Knowledge update job completed', {
      jobId: job.id,
      type: job.data.type,
    });
  });

  worker.on('failed', async (job, error) => {
    logError('assistant.knowledgeWorker.jobFailed', error, {
      feature: 'assistant',
      extra: {
        jobId: job?.id,
        type: job?.data?.type,
        orgId: job?.data?.orgId,
        attemptsMade: job?.attemptsMade,
      },
    });

    // PRD-40: knowledge-update has count-based removeOnFail, so an exhausted
    // job rotates out of Redis unnoticed and the org's assistant corpus stays
    // stale. Dead-letter + alert on terminal failure.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: KNOWLEDGE_UPDATE_QUEUE,
        job,
        error,
        context: { type: job.data?.type, orgId: job.data?.orgId },
      });
    }
  });

  worker.on('error', (error) => {
    // Transient Upstash blips self-heal; warn instead of paging Sentry (API-58).
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('assistant.knowledgeWorker.error', error, {
      feature: 'assistant',
    });
  });

  return worker;
}
