import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type JobsOptions, Queue } from 'bullmq';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { safeJobId } from '../../../shared/queue/index.js';
import {
  CHATBOT_FLOW_QUEUE,
  type ChatbotFlowJobPayload,
  type QueueChatbotFlowInput,
  queueChatbotFlowSchema,
} from './queue-chatbot-flow.schema.js';

const logger = createLogger('QueueChatbotFlow');

// Lazy-initialized queue
let _flowQueue: Queue | null = null;

function getFlowQueue(): Queue {
  if (!_flowQueue) {
    _flowQueue = new Queue(CHATBOT_FLOW_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000, // 5 seconds initial delay
        },
        removeOnComplete: {
          count: 500,
        },
        removeOnFail: {
          count: 200,
        },
      },
    });
  }
  return _flowQueue;
}

/**
 * Queue a chatbot flow execution job.
 *
 * Job ID patterns:
 * - Execute-flow: `flow-{conversationId}-{timestamp}`
 * - Response timeout: `timeout-{conversationId}` (predictable for cancellation)
 */
const queueChatbotFlowImpl = async (
  input: QueueChatbotFlowInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = queueChatbotFlowSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    conversationId,
    userMessage,
    triggerType,
    delayMs,
    pendingMessageParts,
    currentPartIndex,
    skipExternalDelivery,
  } = parsed.data;

  try {
    const queue = getFlowQueue();

    // Use predictable job IDs for cancellable jobs
    let jobId: string;
    if (triggerType === 'timeout') {
      jobId = safeJobId('timeout', conversationId);
    } else if (triggerType === 'deliver_part' && currentPartIndex != null) {
      jobId = safeJobId('msg', conversationId, currentPartIndex);
    } else if (triggerType === 'follow_up') {
      jobId = safeJobId('followup', conversationId);
    } else if (triggerType === 'expire') {
      jobId = safeJobId('expire', conversationId);
    } else if (triggerType === 'booking_fallback') {
      jobId = safeJobId('booking-fallback', conversationId);
    } else {
      // Use unique IDs for message/delay triggers so BullMQ never silently
      // rejects a new job when a previous one is still active.
      // Stale job detection + Redis lock handle the race condition instead.
      jobId = safeJobId('flow', conversationId, Date.now());
    }

    const jobOptions: JobsOptions = { jobId };

    // PRD-40 (idempotency): every trigger except `expire` ends in an external
    // send (deliverMessages → Meta/WhatsApp) BEFORE the conversationMessage row
    // is persisted. A BullMQ retry after a mid-delivery crash re-sends and
    // double-messages the customer — the dedup guard can't help because the
    // very row it checks for is the one that failed to persist. Cap delivery
    // triggers at a single attempt; the per-conversation Redis lock + stale-job
    // guard absorb transient contention. `expire` only flips a DB status, so it
    // keeps the queue's default retry policy.
    if (triggerType !== 'expire') {
      jobOptions.attempts = 1;
    }

    if (delayMs > 0) {
      jobOptions.delay = delayMs;
    }

    const payload: ChatbotFlowJobPayload = {
      conversationId,
      userMessage,
      triggerType,
      queuedAt: new Date().toISOString(),
    };

    if (pendingMessageParts) {
      payload.pendingMessageParts = pendingMessageParts;
    }
    if (currentPartIndex != null) {
      payload.currentPartIndex = currentPartIndex;
    }
    if (skipExternalDelivery) {
      payload.skipExternalDelivery = true;
    }

    const job = await queue.add('execute-flow', payload, jobOptions);

    logger.info('Queued chatbot flow execution', {
      jobId: job.id,
      conversationId,
      triggerType,
      delayMs,
    });

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('chatbots.queueChatbotFlow', error, {
      feature: 'chatbots',
      extra: { conversationId, triggerType },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue chatbot flow execution'
      )
    );
  }
};

export const queueChatbotFlow = (input: QueueChatbotFlowInput) =>
  trackedResult(
    'chatbots.queueChatbotFlow',
    () => queueChatbotFlowImpl(input),
    {
      properties: {
        conversationId: input.conversationId,
        triggerType: input.triggerType,
      },
    }
  );

/**
 * Cancel pending flow execution jobs for a conversation.
 * Scans delayed and waiting jobs for any matching this conversation.
 */
export async function cancelPendingFlow(conversationId: string): Promise<void> {
  try {
    const queue = getFlowQueue();
    const prefix = `flow-${conversationId}-`;

    const delayed = await queue.getDelayed();
    const waiting = await queue.getWaiting();

    for (const job of [...delayed, ...waiting]) {
      if (job.id?.startsWith(prefix)) {
        await job.remove();
        logger.info('Cancelled pending flow', {
          conversationId,
          jobId: job.id,
        });
      }
    }
  } catch (error) {
    logError('chatbots.cancelPendingFlow', error, {
      feature: 'chatbots',
      extra: { conversationId },
    });
  }
}

/**
 * Cancel a pending response timeout job for a conversation.
 * Uses the predictable job ID pattern `timeout-{conversationId}`.
 */
export async function cancelResponseTimeout(
  conversationId: string
): Promise<void> {
  try {
    const queue = getFlowQueue();
    const jobId = `timeout-${conversationId}`;

    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting') {
        await job.remove();
        logger.info('Cancelled response timeout', { conversationId, jobId });
      }
    }
  } catch (error) {
    // Non-critical — if we can't cancel, the timeout will fire and
    // the flow engine will just resume (harmless)
    logError('chatbots.cancelResponseTimeout', error, {
      feature: 'chatbots',
      extra: { conversationId },
    });
  }
}

/**
 * Cancel all pending message part delivery jobs for a conversation.
 * Uses predictable job IDs: `msg-{conversationId}-{0..3}`
 */
export async function cancelPendingMessageParts(
  conversationId: string
): Promise<void> {
  try {
    const queue = getFlowQueue();
    const MAX_PARTS = 4;

    for (let i = 0; i < MAX_PARTS; i++) {
      const jobId = `msg-${conversationId}-${i}`;
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          logger.info('Cancelled pending message part', {
            conversationId,
            jobId,
            partIndex: i,
          });
        }
      }
    }
  } catch (error) {
    logError('chatbots.cancelPendingMessageParts', error, {
      feature: 'chatbots',
      extra: { conversationId },
    });
  }
}

/**
 * Cancel all pending follow-up and expiry jobs for a conversation.
 */
export async function cancelPendingFollowUp(
  conversationId: string
): Promise<void> {
  try {
    const queue = getFlowQueue();

    for (const prefix of ['followup', 'expire']) {
      const jobId = `${prefix}-${conversationId}`;
      const job = await queue.getJob(jobId);
      if (job) {
        const state = await job.getState();
        if (state === 'delayed' || state === 'waiting') {
          await job.remove();
          logger.info('Cancelled pending job', {
            conversationId,
            jobId,
          });
        }
      }
    }
  } catch (error) {
    logError('chatbots.cancelPendingFollowUp', error, {
      feature: 'chatbots',
      extra: { conversationId },
    });
  }
}

/**
 * Cancel a pending booking-fallback job for a conversation. Called when the
 * lead either books via the original link or the org/conversation moves out
 * of `bot_handling`, so we don't offer slots after the fact.
 */
export async function cancelBookingFallback(
  conversationId: string
): Promise<void> {
  try {
    const queue = getFlowQueue();
    const jobId = `booking-fallback-${conversationId}`;
    const job = await queue.getJob(jobId);
    if (job) {
      const state = await job.getState();
      if (state === 'delayed' || state === 'waiting') {
        await job.remove();
        logger.info('Cancelled booking fallback', { conversationId, jobId });
      }
    }
  } catch (error) {
    logError('chatbots.cancelBookingFallback', error, {
      feature: 'chatbots',
      extra: { conversationId },
    });
  }
}

/**
 * Close the queue connection (for graceful shutdown)
 */
export async function closeChatbotFlowQueues(): Promise<void> {
  if (_flowQueue) {
    await _flowQueue.close();
    _flowQueue = null;
  }
  logger.info('Chatbot flow queues closed');
}

/**
 * Get the flow queue for use by the worker
 */
export function getChatbotFlowQueue(): Queue {
  return getFlowQueue();
}

export type QueueChatbotFlowResult = Awaited<
  ReturnType<typeof queueChatbotFlow>
>;
