import { logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { safeJobId } from './safe-job-id.js';

/**
 * Dead-letter queue (DLQ) plumbing shared across every BullMQ producer/worker.
 *
 * Without a DLQ, a job that exhausts its retries either rotates out of Redis
 * (when `removeOnFail` is count-based) or piles up unwatched — in both cases
 * the underlying entity is left in a non-terminal state and nobody is paged.
 * This module standardises the pattern that `video-render` / `graphic-generate`
 * pioneered:
 *
 *   1. on terminal failure, copy the job into a `<queue>-dlq` queue for manual
 *      inspection / replay, and
 *   2. emit an error-level log so BetterStack alert rules (keyed on
 *      `level:error`) fire.
 *
 * Terminal DB status (flipping the asset/analysis/graphic row to `failed`) is
 * still the responsibility of the processor's own catch block — that has to
 * know which table + column to write. This helper covers the queue-level half.
 */

/** Job options for DLQ queues: never auto-evict — operators replay manually. */
export const DLQ_JOB_OPTIONS = {
  removeOnComplete: false,
  removeOnFail: false,
} as const;

const dlqCache = new Map<string, Queue>();

/** Resolve (and lazily create) the DLQ queue for a given source queue name. */
export function getDeadLetterQueue(sourceQueueName: string): Queue {
  const dlqName = sourceQueueName.endsWith('-dlq')
    ? sourceQueueName
    : `${sourceQueueName}-dlq`;

  let queue = dlqCache.get(dlqName);
  if (!queue) {
    queue = new Queue(dlqName, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: DLQ_JOB_OPTIONS,
    });
    dlqCache.set(dlqName, queue);
  }
  return queue;
}

/** Minimal shape of a BullMQ job needed to dead-letter it. */
export interface DeadLetterableJob {
  id?: string | null;
  name?: string;
  data: unknown;
  failedReason?: string;
  attemptsMade?: number;
  opts?: { attempts?: number };
}

/**
 * Whether a failed job has exhausted all of its configured attempts and is
 * therefore terminal. BullMQ's `failed` event fires on every attempt, so
 * worker handlers must gate dead-lettering on this to avoid DLQ-ing a job
 * that still has retries left.
 */
export function isTerminalFailure(job?: DeadLetterableJob | null): boolean {
  if (!job) return false;
  const maxAttempts = job.opts?.attempts ?? 1;
  return (job.attemptsMade ?? 0) >= maxAttempts;
}

export interface MoveToDeadLetterInput {
  /** Source queue name (the `-dlq` suffix is added automatically). */
  queueName: string;
  job: DeadLetterableJob;
  error?: unknown;
  /** Extra context for the alert log (ids that aid triage). */
  context?: Record<string, unknown>;
}

/**
 * Copy a terminally-failed job into its dead-letter queue and raise an alert.
 *
 * Best-effort: never throws — a DLQ write failing must not mask the original
 * job failure. Callers typically invoke this from a worker's `failed` handler
 * after `isTerminalFailure(job)` returns true.
 */
export async function moveToDeadLetter({
  queueName,
  job,
  error,
  context,
}: MoveToDeadLetterInput): Promise<void> {
  const failedReason =
    job.failedReason ??
    (error instanceof Error
      ? error.message
      : error
        ? String(error)
        : 'Unknown error');

  try {
    const dlq = getDeadLetterQueue(queueName);
    await dlq.add(
      'dead-letter',
      {
        sourceQueue: queueName,
        originalJobId: job.id ?? null,
        jobName: job.name ?? null,
        data: job.data,
        failedReason,
        attemptsMade: job.attemptsMade ?? null,
        failedAt: new Date().toISOString(),
        ...context,
      },
      {
        jobId: safeJobId('dlq', queueName, job.id ?? 'unknown', Date.now()),
      }
    );
  } catch (dlqError) {
    logError(`queue.deadLetter.enqueueFailed.${queueName}`, dlqError, {
      feature: 'queue',
      tags: { queue: queueName },
      extra: { originalJobId: job.id, failedReason },
    });
  }

  // Alert: error-level log so BetterStack/Sentry surface the dead-letter event.
  logError(
    `queue.deadLetter.${queueName}`,
    error instanceof Error ? error : new Error(failedReason),
    {
      feature: 'queue',
      tags: { queue: queueName, deadLetter: 'true' },
      extra: {
        queueName,
        originalJobId: job.id,
        attemptsMade: job.attemptsMade,
        failedReason,
        ...context,
      },
    }
  );
}
