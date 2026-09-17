import { trackedResult } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Queue } from 'bullmq';
import { type Result, ok } from '../../../shared/index.js';
import { safeJobId } from '../../../shared/queue/index.js';

/** Queue that drives the once-per-service stock matcher off the request path. */
export const STOCK_MATCH_QUEUE = 'stock-match';

let stockMatchQueue: Queue | null = null;

const RETRY_CONFIG = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
};

export function getStockMatchQueue(): Queue {
  if (!stockMatchQueue) {
    stockMatchQueue = new Queue(STOCK_MATCH_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: false,
        ...RETRY_CONFIG,
      },
    });
  }
  return stockMatchQueue;
}

export interface StockMatchJobPayload {
  organizationServiceId: string;
  /**
   * Re-run classification even though the row already carries
   * `technique_classified_at`. Set by the UPDATE path only — a renamed or
   * re-described service is a genuinely different question, whereas a plain
   * re-match should reuse the answer rather than pay for two more LLM calls.
   */
  reclassify?: boolean;
}

/**
 * Enqueue a stock-match job for a service. A stable jobId dedupes rapid
 * re-edits (BullMQ ignores a duplicate id while one is waiting/active), so two
 * quick saves don't trigger two LLM calls. Fire-and-forget at the call site —
 * matching is best-effort and the selector falls back to the generic pool until
 * it lands.
 */
const enqueueStockMatchImpl = async (
  input: StockMatchJobPayload
): Promise<Result<{ enqueued: boolean }>> => {
  if (!input.organizationServiceId) return ok({ enqueued: false });
  const queue = getStockMatchQueue();
  await queue.add(
    'resolve',
    {
      organizationServiceId: input.organizationServiceId,
      reclassify: input.reclassify ?? false,
    },
    { jobId: safeJobId('stock-match', input.organizationServiceId) }
  );
  return ok({ enqueued: true });
};

export const enqueueStockMatch = (input: StockMatchJobPayload) =>
  trackedResult(
    'stockFootage.enqueueStockMatch',
    () => enqueueStockMatchImpl(input),
    { properties: { organizationServiceId: input.organizationServiceId } }
  );

export async function closeStockMatchQueue(): Promise<void> {
  if (stockMatchQueue) {
    await stockMatchQueue.close();
    stockMatchQueue = null;
  }
}
