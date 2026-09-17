/**
 * `queueGraphicGenerate` — enqueue a graphic generation job onto the
 * `graphic-generate` BullMQ queue.
 *
 * Used by:
 *   - `generateGraphicFromService` (socials new-post) → mode='plan-and-render'
 *   - `generateMonthlyBatch` (bulk content batches)   → mode='render-only'
 *
 * The consumer lives in `apps/video-worker/src/graphic-generate-processor.ts`.
 * The worker runs N concurrent jobs (see GRAPHIC_GENERATE_CONCURRENCY), so a
 * bulk batch of ~12 graphics drains in parallel rather than blocking on each
 * other in the API process.
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
  GRAPHIC_GENERATE_DLQ,
  GRAPHIC_GENERATE_QUEUE,
  type GraphicGenerateJobPayload,
  type QueueGraphicGenerateInput,
  queueGraphicGenerateSchema,
} from './queue-graphic-generate.schema.js';

let graphicGenerateQueue: Queue | null = null;
let graphicGenerateDlq: Queue | null = null;

// Retry with exponential backoff (10s/20s/40s): Gemini rate-limit storms
// (429) are the dominant transient failure and DO clear once the worker
// limiter + in-call backoff drain the burst — the processor rethrows
// RATE_LIMITED without marking the graphic failed while attempts remain.
const RETRY_CONFIG = {
  attempts: 4,
  backoff: {
    type: 'exponential' as const,
    delay: 10000,
  },
};

function getGraphicGenerateQueue(): Queue {
  if (!graphicGenerateQueue) {
    graphicGenerateQueue = new Queue(GRAPHIC_GENERATE_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: 100,
        removeOnFail: false,
        ...RETRY_CONFIG,
      },
    });
  }
  return graphicGenerateQueue;
}

function getGraphicGenerateDlq(): Queue {
  if (!graphicGenerateDlq) {
    graphicGenerateDlq = new Queue(GRAPHIC_GENERATE_DLQ, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
      },
    });
  }
  return graphicGenerateDlq;
}

const queueGraphicGenerateImpl = async (
  input: QueueGraphicGenerateInput
): Promise<Result<{ jobId: string; graphicId: string }>> => {
  const parsed = queueGraphicGenerateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const queue = getGraphicGenerateQueue();
    // jobId = graphicId so each graphic dedupes to one job. A double-click
    // on the socials "Generate" button won't enqueue two renders for the
    // same placeholder row.
    const job = await queue.add('generate', parsed.data, {
      jobId: parsed.data.graphicId,
    });
    return ok({
      jobId: job.id ?? parsed.data.graphicId,
      graphicId: parsed.data.graphicId,
    });
  } catch (error) {
    logError('graphics.queueGraphicGenerate', error, {
      feature: 'graphics',
      extra: {
        graphicId: parsed.data.graphicId,
        organizationId: parsed.data.organizationId,
        mode: parsed.data.mode,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue graphic generation'
      )
    );
  }
};

export const queueGraphicGenerate = (input: QueueGraphicGenerateInput) =>
  trackedResult(
    'graphics.queueGraphicGenerate',
    () => queueGraphicGenerateImpl(input),
    {
      properties: {
        graphicId: input.graphicId,
        organizationId: input.organizationId,
        mode: input.mode,
      },
    }
  );

export type QueueGraphicGenerateResult = Awaited<
  ReturnType<typeof queueGraphicGenerate>
>;

/**
 * Move a failed graphic-generate job to the dead letter queue.
 * Called by the worker when a job fails after all retries.
 */
export async function moveToGraphicGenerateDLQ(originalJob: {
  id: string;
  data: GraphicGenerateJobPayload;
  failedReason?: string;
  attemptsMade: number;
}): Promise<void> {
  const dlq = getGraphicGenerateDlq();
  await dlq.add(
    'failed-generate',
    {
      originalJobId: originalJob.id,
      graphicId: originalJob.data.graphicId,
      organizationId: originalJob.data.organizationId,
      mode: originalJob.data.mode,
      payload: originalJob.data,
      failedReason: originalJob.failedReason || 'Unknown error',
      attemptsMade: originalJob.attemptsMade,
      failedAt: new Date().toISOString(),
    },
    {
      jobId: `dlq-${originalJob.id}-${Date.now()}`,
    }
  );
}

/**
 * Close queue connections (for graceful shutdown).
 */
export async function closeGraphicGenerateQueue(): Promise<void> {
  if (graphicGenerateQueue) {
    await graphicGenerateQueue.close();
    graphicGenerateQueue = null;
  }
  if (graphicGenerateDlq) {
    await graphicGenerateDlq.close();
    graphicGenerateDlq = null;
  }
}
