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
  CLAIRE_WHATSAPP_TURN_QUEUE,
  type ClaireWhatsappTurnJobPayload,
  claireWhatsappTurnJobSchema,
} from './claire-whatsapp-turn.schema.js';

const logger = createLogger('QueueClaireWhatsappTurn');

let _queue: Queue | null = null;

function getQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(CLAIRE_WHATSAPP_TURN_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        // A Claire turn runs the full tool loop; a transient failure is worth
        // one retry, but we don't want to spam ads on repeated publish turns.
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _queue;
}

/**
 * Enqueue an inbound Claire-on-WhatsApp owner turn. The job id is keyed on the
 * inbound WhatsApp message id so a webhook redelivery of the same message
 * doesn't double-run the turn (BullMQ rejects a duplicate active/completed id).
 */
const queueClaireWhatsappTurnImpl = async (
  input: ClaireWhatsappTurnJobPayload
): Promise<Result<{ jobId: string }>> => {
  const parsed = claireWhatsappTurnJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const queue = getQueue();
    const payload: ClaireWhatsappTurnJobPayload = {
      ...parsed.data,
      queuedAt: new Date().toISOString(),
    };
    const job = await queue.add('claire-turn', payload, {
      jobId: `claire-wa-${parsed.data.inboundMessageId}`,
    });

    logger.info('Queued Claire WhatsApp turn', {
      jobId: job.id,
      organizationId: parsed.data.organizationId,
    });

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('assistant.queueClaireWhatsappTurn', error, {
      feature: 'assistant',
      extra: {
        organizationId: input.organizationId,
        inboundMessageId: input.inboundMessageId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue Claire WhatsApp turn'
      )
    );
  }
};

export const queueClaireWhatsappTurn = (input: ClaireWhatsappTurnJobPayload) =>
  trackedResult(
    'assistant.queueClaireWhatsappTurn',
    () => queueClaireWhatsappTurnImpl(input),
    { properties: { organizationId: input.organizationId } }
  );

/** Get the queue (for the worker). */
export function getClaireWhatsappTurnQueue(): Queue {
  return getQueue();
}

/** Close the queue connection (graceful shutdown). */
export async function closeClaireWhatsappTurnQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  logger.info('Claire WhatsApp turn queue closed');
}

export type QueueClaireWhatsappTurnResult = Awaited<
  ReturnType<typeof queueClaireWhatsappTurn>
>;
