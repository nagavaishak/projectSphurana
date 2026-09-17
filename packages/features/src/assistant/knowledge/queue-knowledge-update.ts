import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { safeJobId } from '../../shared/queue/index.js';
import {
  populateAdInsights,
  populateAll,
  populateCustomerPatterns,
  populateOrgProfile,
  populatePostInsights,
  populateServices,
  populateVideoPreferences,
} from './populate.js';

const logger = createLogger('KnowledgeUpdateQueue');

// ---------------------------------------------------------------------------
// Queue name & types
// ---------------------------------------------------------------------------

export const KNOWLEDGE_UPDATE_QUEUE = 'knowledge-update';

export type KnowledgeUpdateType =
  | 'ad_sync'
  | 'post_published'
  | 'video_ready'
  | 'org_updated'
  | 'lead_created'
  | 'full_refresh';

export interface KnowledgeUpdateJobPayload {
  type: KnowledgeUpdateType;
  orgId: string;
}

// ---------------------------------------------------------------------------
// Queue singleton (lazy init)
// ---------------------------------------------------------------------------

let _knowledgeQueue: Queue | null = null;

function getKnowledgeQueue(): Queue {
  if (!_knowledgeQueue) {
    _knowledgeQueue = new Queue(KNOWLEDGE_UPDATE_QUEUE, {
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
  return _knowledgeQueue;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Enqueue a knowledge update job.
 * Uses `knowledge-${type}-${orgId}` as jobId for deduplication —
 * BullMQ ignores jobs with a duplicate ID already queued/active.
 */
export async function queueKnowledgeUpdate(
  type: KnowledgeUpdateType,
  orgId: string
): Promise<void> {
  try {
    const queue = getKnowledgeQueue();
    await queue.add(type, { type, orgId } satisfies KnowledgeUpdateJobPayload, {
      jobId: safeJobId('knowledge', type, orgId),
    });
    logger.debug('Knowledge update job queued', { type, orgId });
  } catch (error) {
    logError('assistant.queueKnowledgeUpdate', error, {
      feature: 'assistant',
      extra: { type, orgId },
    });
  }
}

/**
 * Process a knowledge update job by calling the appropriate populate function.
 */
export async function processKnowledgeUpdateJob(
  payload: KnowledgeUpdateJobPayload
): Promise<void> {
  const { type, orgId } = payload;

  switch (type) {
    case 'ad_sync':
      await populateAdInsights(orgId);
      break;
    case 'post_published':
      await populatePostInsights(orgId);
      break;
    case 'video_ready':
      await populateVideoPreferences(orgId);
      break;
    case 'org_updated':
      await populateOrgProfile(orgId);
      await populateServices(orgId);
      break;
    case 'lead_created':
      await populateCustomerPatterns(orgId);
      break;
    case 'full_refresh':
      await populateAll(orgId);
      break;
    default:
      logger.warn('Unknown knowledge update type', { type, orgId });
  }
}

/**
 * Close the queue connection. Call during module shutdown.
 */
export async function closeKnowledgeUpdateQueue(): Promise<void> {
  if (_knowledgeQueue) {
    await _knowledgeQueue.close();
    _knowledgeQueue = null;
  }
  logger.info('Knowledge update queue closed');
}

/**
 * Get the raw BullMQ Queue instance (for the worker module).
 */
export function getKnowledgeUpdateQueue(): Queue {
  return getKnowledgeQueue();
}
