/**
 * `queueMetaSync` — enqueue a Meta data sync onto the `meta-sync` BullMQ queue
 * so the slow Meta Graph API work runs on the worker fleet instead of on the
 * API request path.
 *
 * Why: `syncMetaData` makes sequential Meta Graph API calls that take ~11-12s.
 * Run inline on `POST /meta-campaigns/sync-all` (which fires on every fresh
 * session), those long requests occupy the API's small DB pool and starve
 * interactive traffic. Offloading to the worker keeps the API request fast
 * (this just enqueues and returns) and moves the work onto the worker's own
 * pool under the transaction-free SYSTEM scope.
 *
 * The consumer lives in `apps/video-worker/src/meta-sync-processor.ts`.
 */

import { logError, trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  META_SYNC_QUEUE,
  type QueueMetaSyncInput,
  queueMetaSyncSchema,
} from './queue-meta-sync.schema.js';

let metaSyncQueue: Queue | null = null;

// The sync is idempotent and the scheduler also runs it every 15 min, so a
// failed enqueue isn't worth aggressive retries. 2 attempts with 30s backoff
// rides out a brief Meta/Neon blip.
const RETRY_CONFIG = {
  attempts: 2,
  backoff: {
    type: 'exponential' as const,
    delay: 30000,
  },
};

function getMetaSyncQueue(): Queue {
  if (!metaSyncQueue) {
    metaSyncQueue = new Queue(META_SYNC_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        // Remove on success so the per-org jobId frees up for the next trigger.
        removeOnComplete: true,
        removeOnFail: 50,
        ...RETRY_CONFIG,
      },
    });
  }
  return metaSyncQueue;
}

const queueMetaSyncImpl = async (
  input: QueueMetaSyncInput
): Promise<
  Result<{ jobId: string; organizationId: string; queued: boolean }>
> => {
  const parsed = queueMetaSyncSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const queue = getMetaSyncQueue();
    // jobId = one in-flight sync per org. While a sync is queued/active, repeat
    // triggers (every session, org switch, tab) collapse onto it instead of
    // piling up duplicate 12s syncs.
    const job = await queue.add('sync', parsed.data, {
      jobId: `meta-sync-${organizationId}`,
    });
    return ok({
      jobId: job.id ?? `meta-sync-${organizationId}`,
      organizationId,
      queued: true,
    });
  } catch (error) {
    logError('metaSync.queueMetaSync', error, {
      feature: 'meta-sync',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to queue Meta sync')
    );
  }
};

export const queueMetaSync = (input: QueueMetaSyncInput) =>
  trackedResult('metaSync.queueMetaSync', () => queueMetaSyncImpl(input), {
    properties: { organizationId: input.organizationId },
  });

export type QueueMetaSyncResult = Awaited<ReturnType<typeof queueMetaSync>>;

/** Close the queue connection (graceful shutdown). */
export async function closeMetaSyncQueue(): Promise<void> {
  if (metaSyncQueue) {
    await metaSyncQueue.close();
    metaSyncQueue = null;
  }
}
