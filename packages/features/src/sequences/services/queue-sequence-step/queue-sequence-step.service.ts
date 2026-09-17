import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type JobsOptions, Queue } from 'bullmq';
import { sequenceExecutionQueue } from '../../../jobs/index.js';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type QueueFirstStepInput,
  type QueueSequenceStepInput,
  SEQUENCE_EXECUTION_DLQ,
  SEQUENCE_EXECUTION_QUEUE,
  type SequenceStepJobPayload,
  queueFirstStepSchema,
  queueSequenceStepSchema,
} from './queue-sequence-step.schema.js';

const logger = createLogger('QueueSequenceStep');

// Lazy-initialized queues
let _executionQueue: Queue | null = null;
let _dlqQueue: Queue | null = null;

/**
 * Get the sequence execution queue instance
 */
function getExecutionQueue(): Queue {
  if (!_executionQueue) {
    _executionQueue = new Queue(SEQUENCE_EXECUTION_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 30000, // 30 seconds initial delay
        },
        removeOnComplete: {
          count: 1000, // Keep last 1000 completed jobs
        },
        removeOnFail: false, // Keep failed jobs for DLQ processing
      },
    });
  }
  return _executionQueue;
}

/**
 * Get the dead letter queue instance
 */
function getDLQQueue(): Queue {
  if (!_dlqQueue) {
    _dlqQueue = new Queue(SEQUENCE_EXECUTION_DLQ, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: {
          age: 7 * 24 * 60 * 60, // Keep for 7 days
        },
        removeOnFail: {
          age: 30 * 24 * 60 * 60, // Keep failed DLQ items for 30 days
        },
      },
    });
  }
  return _dlqQueue;
}

/**
 * Queue a sequence step for execution
 *
 * @param input - Step execution details
 * @returns Job ID if successful
 *
 * @example
 * ```ts
 * const result = await queueSequenceStep({
 *   leadId: 'lead-123',
 *   sequenceId: 'seq-456',
 *   organizationId: 'org-789',
 *   stepId: 'step-abc',
 *   delayMs: 60000, // Execute in 1 minute
 * });
 * ```
 */
const queueSequenceStepImpl = async (
  input: QueueSequenceStepInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = queueSequenceStepSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // The `sequence-execution` queue has a producer and NO worker — it never has
  // had one. Today that is harmless only because this function has no callers.
  // Rather than leave the gun loaded (the first caller would enqueue nurture
  // steps that silently never run, with nothing to show for it), refuse loudly,
  // quoting the reason recorded on the queue declaration. Registering a worker
  // deletes this guard and the `disabled` line together.
  if (sequenceExecutionQueue.disabled) {
    return err(
      new FeatureError(
        ErrorCodes.INVALID_STATE,
        `sequence-execution queue is disabled — a job enqueued here would never run. ${sequenceExecutionQueue.disabled}`
      )
    );
  }

  const { leadId, sequenceId, organizationId, stepId, delayMs } = parsed.data;

  try {
    const queue = getExecutionQueue();

    const jobOptions: JobsOptions = {
      jobId: `seq-${sequenceId}-lead-${leadId}-${stepId || 'first'}-${Date.now()}`,
    };

    if (delayMs > 0) {
      jobOptions.delay = delayMs;
    }

    const job = await queue.add(
      'execute-step',
      {
        leadId,
        sequenceId,
        organizationId,
        stepId,
      } as SequenceStepJobPayload,
      jobOptions
    );

    logger.info('Queued sequence step', {
      jobId: job.id,
      leadId,
      sequenceId,
      stepId: stepId || 'first',
      delayMs,
    });

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('sequences.queueSequenceStep', error, {
      feature: 'sequences',
      extra: { leadId, sequenceId, stepId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue sequence step'
      )
    );
  }
};

export const queueSequenceStep = (input: QueueSequenceStepInput) =>
  trackedResult(
    'sequences.queueSequenceStep',
    () => queueSequenceStepImpl(input),
    {
      properties: { leadId: input.leadId, sequenceId: input.sequenceId },
    }
  );

/**
 * Queue the first step of a sequence for a lead
 * This is the entry point when a new lead comes in from Facebook
 *
 * @param input - Lead and sequence details
 * @returns Job ID if successful
 *
 * @example
 * ```ts
 * // Queue immediately
 * const result = await queueFirstStep({
 *   leadId: 'lead-123',
 *   sequenceId: 'seq-456',
 *   organizationId: 'org-789',
 *   delayMs: 0,
 * });
 * ```
 */
const queueFirstStepImpl = async (
  input: QueueFirstStepInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = queueFirstStepSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, sequenceId, organizationId, delayMs } = parsed.data;

  // Queue without stepId to indicate first step
  return queueSequenceStepImpl({
    leadId,
    sequenceId,
    organizationId,
    stepId: undefined,
    delayMs,
  });
};

export const queueFirstStep = (input: QueueFirstStepInput) =>
  trackedResult('sequences.queueFirstStep', () => queueFirstStepImpl(input), {
    properties: { leadId: input.leadId, sequenceId: input.sequenceId },
  });

/**
 * Response type for queue operations
 */
export interface QueueJobResponse {
  jobId: string;
}

/**
 * Response type for DLQ operations
 */
export interface DLQJobResponse {
  dlqJobId: string;
}

/**
 * Failed job data structure for DLQ
 */
export interface FailedJobData {
  id: string;
  data: SequenceStepJobPayload;
  failedReason?: string;
  attemptsMade: number;
}

/**
 * Move a failed job to the dead letter queue
 *
 * @param data - Failed job data
 * @returns Job ID in DLQ if successful
 */
const moveToDeadLetterQueueImpl = async (
  data: FailedJobData
): Promise<Result<{ dlqJobId: string }>> => {
  try {
    const dlq = getDLQQueue();

    const dlqData = {
      ...data,
      failedAt: new Date().toISOString(),
    };

    const job = await dlq.add('failed-execution', dlqData, {
      jobId: `dlq-${data.id}-${Date.now()}`,
    });

    logger.warn('Moved job to dead letter queue', {
      originalJobId: data.id,
      dlqJobId: job.id,
      leadId: data.data.leadId,
      sequenceId: data.data.sequenceId,
      failedReason: data.failedReason,
      attemptsMade: data.attemptsMade,
    });

    return ok({ dlqJobId: job.id || '' });
  } catch (error) {
    logError('sequences.moveToDeadLetterQueue', error, {
      feature: 'sequences',
      extra: { originalJobId: data.id },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to move to dead letter queue'
      )
    );
  }
};

export const moveToSequenceDLQ = (data: FailedJobData) =>
  trackedResult('sequences.moveToDeadLetterQueue', () =>
    moveToDeadLetterQueueImpl(data)
  );

/**
 * Close the queue connections (for graceful shutdown)
 */
export async function closeSequenceQueues(): Promise<void> {
  if (_executionQueue) {
    await _executionQueue.close();
    _executionQueue = null;
  }
  if (_dlqQueue) {
    await _dlqQueue.close();
    _dlqQueue = null;
  }
  logger.info('Sequence queues closed');
}

/**
 * Get the execution queue for use by the worker
 * This is exported for the worker to create the processor
 */
export function getSequenceExecutionQueue(): Queue {
  return getExecutionQueue();
}

/**
 * Result types
 */
export type QueueSequenceStepResult = Awaited<
  ReturnType<typeof queueSequenceStep>
>;
export type QueueFirstStepResult = Awaited<ReturnType<typeof queueFirstStep>>;
export type MoveToSequenceDLQResult = Awaited<
  ReturnType<typeof moveToSequenceDLQ>
>;
