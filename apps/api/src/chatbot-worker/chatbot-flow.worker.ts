import { db, withSystemScope } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import {
  CHATBOT_FLOW_QUEUE,
  type ChatbotFlowJobPayload,
  processChatbotFlowJob,
} from '@borradh-workspace/features/chatbots';
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

const logger = createLogger('ChatbotFlowWorker');

/**
 * Create and return the BullMQ worker for the chatbot-flow queue.
 */
export function createChatbotFlowWorker(): Worker {
  const worker = new Worker<ChatbotFlowJobPayload>(
    CHATBOT_FLOW_QUEUE,
    async (job: Job<ChatbotFlowJobPayload>) => {
      logger.info('Processing chatbot flow job', {
        jobId: job.id,
        conversationId: job.data.conversationId,
        triggerType: job.data.triggerType,
      });

      await withSystemScope(
        (conn) =>
          processChatbotFlowJob(conn, {
            payload: job.data,
            apiKey: apiEnv.OPENAI_API_KEY,
          }),
        { db }
      );
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 10,
      limiter: {
        max: 50,
        duration: 1000,
      },
      // PRD-40: a single AI turn (generateAIResponse + tool calls + delivery)
      // can exceed BullMQ's default 30s lockDuration/stalledInterval, which
      // would let stalled-recovery run the same conversation on a second worker
      // mid-turn. Size the job lock above the worst-case turn. The Redis
      // per-conversation lock (acquireConversationLock, 180s TTL) sits above
      // this so it still guards the rare case where a turn outlives even this.
      lockDuration: 120_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
    }
  );

  worker.on('completed', (job) => {
    logger.debug('Job completed', { jobId: job.id });
  });

  worker.on('failed', async (job, error) => {
    logError('chatbots.flowWorker.jobFailed', error, {
      feature: 'chatbots',
      extra: {
        jobId: job?.id,
        conversationId: job?.data?.conversationId,
        attemptsMade: job?.attemptsMade,
      },
    });

    // PRD-40: dead-letter terminally-failed flow jobs so a customer's stuck
    // conversation is captured + alerted instead of silently rotating out of
    // Redis (removeOnFail is count-based on this queue). Delivery triggers run
    // attempts:1, so a single failure is already terminal for them.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: CHATBOT_FLOW_QUEUE,
        job,
        error,
        context: {
          conversationId: job.data?.conversationId,
          triggerType: job.data?.triggerType,
        },
      });
    }
  });

  worker.on('stalled', (jobId) => {
    logger.warn(
      'Job stalled and will be recovered — duplicate guard will prevent re-delivery',
      {
        jobId,
      }
    );
  });

  worker.on('error', (error) => {
    // Transient Upstash blips (failover/upgrade, severed connection, Lua
    // `execution timed out`, request-cap) self-heal via retryStrategy +
    // BullMQ's own retry/stalled recovery. Warn instead of paging Sentry —
    // they fire across every worker at once during an Upstash event (API-58).
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('chatbots.flowWorker.error', error, {
      feature: 'chatbots',
    });
  });

  return worker;
}
