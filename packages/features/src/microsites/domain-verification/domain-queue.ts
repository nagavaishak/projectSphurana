/**
 * The BullMQ producer side (contract §6: same shape as
 * `assistant/whatsapp-turn-queue`).
 *
 * Split from the processor deliberately: the verification service enqueues a
 * `domain_changed` job, and the processor imports the verification service. In
 * one file that is an import cycle; in two it is a straight line.
 *
 * Every enqueue is fire-and-forget with a DETERMINISTIC job id. That id is what
 * makes the §4 fan-out safe to run twice: BullMQ rejects a duplicate id while
 * the job is waiting/active/completed, so two workers that both observe the
 * same primary flip produce ONE ad rewrite and ONE Meta notice.
 */

import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { safeJobId } from '../../shared/queue/index.js';
import {
  DOMAIN_CHANGED_JOB,
  MICROSITE_DOMAIN_QUEUE,
  SWEEP_INTERVAL_MS,
  VERIFY_SWEEP_JOB,
} from './domain-verification.constants.js';
import {
  type DomainChangedJobPayload,
  domainChangedJobSchema,
} from './domain-verification.schema.js';

const logger = createLogger('MicrositeDomainQueue');

let _queue: Queue | null = null;

export function getMicrositeDomainQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(MICROSITE_DOMAIN_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _queue;
}

/**
 * Register the repeatable sweep (contract §2 step 3). Idempotent: BullMQ keys a
 * repeatable job on name + pattern, so every API boot re-asserting it is a
 * no-op rather than a second schedule.
 */
export async function ensureMicrositeDomainSweepSchedule(): Promise<void> {
  try {
    await getMicrositeDomainQueue().add(
      VERIFY_SWEEP_JOB,
      {},
      {
        repeat: { every: SWEEP_INTERVAL_MS },
        jobId: 'microsite-domain-verify-sweep',
        removeOnComplete: { count: 20 },
      }
    );
  } catch (error) {
    logError('microsites.ensureDomainSweepSchedule', error, {
      feature: 'microsites',
    });
  }
}

/**
 * Enqueue the §4 fan-out for a primary-host change.
 *
 * The job id is `(domainId, newHost)`: re-running the same change is refused,
 * but a LATER move to a different host is a different job and still runs.
 */
export async function enqueueDomainChanged(
  payload: DomainChangedJobPayload
): Promise<{ jobId: string | null }> {
  const parsed = domainChangedJobSchema.safeParse(payload);
  if (!parsed.success) {
    logError(
      'microsites.enqueueDomainChanged',
      new Error('Invalid domain_changed payload'),
      { feature: 'microsites', extra: { issues: parsed.error.issues } }
    );
    return { jobId: null };
  }

  try {
    const job = await getMicrositeDomainQueue().add(
      DOMAIN_CHANGED_JOB,
      parsed.data,
      {
        jobId: safeJobId(
          'microsite-domain-changed',
          parsed.data.domainId,
          parsed.data.newHost
        ),
      }
    );
    logger.info('Queued microsite domain_changed', {
      jobId: job.id,
      micrositeId: parsed.data.micrositeId,
    });
    return { jobId: job.id ?? null };
  } catch (error) {
    // Log and swallow: the domain IS active and the row already records it.
    // Failing the activation because the follow-up queue is down would be the
    // worse trade.
    logError('microsites.enqueueDomainChanged', error, {
      feature: 'microsites',
      extra: {
        micrositeId: payload.micrositeId,
        organizationId: payload.organizationId,
      },
    });
    return { jobId: null };
  }
}

export async function closeMicrositeDomainQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
}
