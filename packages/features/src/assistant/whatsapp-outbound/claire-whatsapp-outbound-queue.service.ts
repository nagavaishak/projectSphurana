import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../shared/index.js';
import {
  CLAIRE_WHATSAPP_OUTBOUND_QUEUE,
  type ClaireWhatsappOutboundJobPayload,
  claireWhatsappOutboundJobSchema,
} from './claire-whatsapp-outbound.schema.js';

const logger = createLogger('QueueClaireWhatsappOutbound');

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(CLAIRE_WHATSAPP_OUTBOUND_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        // Delivery is a couple of Meta API calls; a transient failure is worth
        // a few retries, but don't spam the owner forever.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _queue;
}

/**
 * Enqueue a proactive/async delivery to a paired Claire-on-WhatsApp owner.
 * Producers run wherever an async job completes (e.g. the video render worker);
 * the API `chatbot-worker` consumes and delivers.
 *
 * When `dedupeKey` is set it becomes the BullMQ jobId, so a producer that fires
 * the same completion twice doesn't double-message the owner (BullMQ rejects a
 * duplicate active/completed id).
 */
const queueClaireWhatsappOutboundImpl = async (
  input: ClaireWhatsappOutboundJobPayload
): Promise<Result<{ jobId: string }>> => {
  const parsed = claireWhatsappOutboundJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const queue = getQueue();
    const payload: ClaireWhatsappOutboundJobPayload = {
      ...parsed.data,
      queuedAt: new Date().toISOString(),
    };
    const job = await queue.add('claire-outbound', payload, {
      // BullMQ forbids ':' in custom job ids — sanitize the dedupe key (callers
      // use natural keys like `video-ready:<id>`).
      ...(parsed.data.dedupeKey
        ? {
            jobId: `claire-wa-out-${parsed.data.dedupeKey.replace(/:/g, '_')}`,
          }
        : {}),
    });

    logger.info('Queued Claire WhatsApp outbound delivery', {
      jobId: job.id,
      organizationId: parsed.data.organizationId,
      conversationId: parsed.data.conversationId,
    });

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('assistant.queueClaireWhatsappOutbound', error, {
      feature: 'assistant',
      extra: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        dedupeKey: input.dedupeKey,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue Claire WhatsApp outbound delivery'
      )
    );
  }
};

export const queueClaireWhatsappOutbound = (
  input: ClaireWhatsappOutboundJobPayload
) =>
  trackedResult(
    'assistant.queueClaireWhatsappOutbound',
    () => queueClaireWhatsappOutboundImpl(input),
    { properties: { organizationId: input.organizationId } }
  );

/** Get the queue (for the worker). */
export function getClaireWhatsappOutboundQueue(): Queue {
  return getQueue();
}

/** Close the queue connection (graceful shutdown). */
export async function closeClaireWhatsappOutboundQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  logger.info('Claire WhatsApp outbound queue closed');
}

export type QueueClaireWhatsappOutboundResult = Awaited<
  ReturnType<typeof queueClaireWhatsappOutbound>
>;
