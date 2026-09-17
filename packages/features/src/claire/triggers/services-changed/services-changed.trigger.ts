import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';

const logger = createLogger('ClaireClassifyQueue');

// ---------------------------------------------------------------------------
// Queue name + payload
// ---------------------------------------------------------------------------

export const CLAIRE_CLASSIFY_QUEUE = 'claire-classify';

export type ClaireClassifyJobReason =
  | 'onboarding_completed'
  | 'services_changed'
  | 'manual';

export interface ClaireClassifyJobPayload {
  organizationId: string;
  reason: ClaireClassifyJobReason;
  force?: boolean;
}

// ---------------------------------------------------------------------------
// Lazy queue singleton
// ---------------------------------------------------------------------------

let _queue: Queue | null = null;

function getClassifyQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(CLAIRE_CLASSIFY_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return _queue;
}

export function getClaireClassifyQueue(): Queue {
  return getClassifyQueue();
}

export async function closeClaireClassifyQueue(): Promise<void> {
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  logger.info('Claire classify queue closed');
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// Debounce window for service-CRUD-driven reclassifies. If a clinic owner
// edits 5 services in 2 minutes during onboarding, we only want to classify
// once after they're done. Tune later.
const SERVICES_CHANGED_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Trigger a debounced reclassification after the org's service menu changes.
 *
 * Implementation: BullMQ jobs with a stable jobId (`claire-classify-{orgId}`)
 * delayed by SERVICES_CHANGED_DEBOUNCE_MS. BullMQ ignores additions with a
 * duplicate jobId already queued/active, so rapid-fire calls collapse into a
 * single delayed run.
 *
 * Safe to call from inside service-CRUD endpoints (no awaiting on the
 * classifier itself — only the enqueue is awaited).
 */
export async function triggerServicesChanged(
  organizationId: string
): Promise<void> {
  try {
    const queue = getClassifyQueue();
    await queue.add(
      'services_changed',
      {
        organizationId,
        reason: 'services_changed',
      } satisfies ClaireClassifyJobPayload,
      {
        jobId: `claire-classify-${organizationId}`,
        delay: SERVICES_CHANGED_DEBOUNCE_MS,
      }
    );
    logger.debug('Services-changed classify queued', { organizationId });
  } catch (error) {
    logError('claire.triggerServicesChanged', error, {
      feature: 'claire',
      extra: { organizationId },
    });
  }
}
