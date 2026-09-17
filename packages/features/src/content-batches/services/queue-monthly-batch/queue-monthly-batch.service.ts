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
import { safeJobId } from '../../../shared/queue/index.js';
import {
  CONTENT_BATCH_GENERATE_QUEUE,
  type ContentBatchGenerationJobPayload,
  contentBatchGenerationJobSchema,
} from './queue-monthly-batch.schema.js';

let generationQueue: Queue<ContentBatchGenerationJobPayload> | null = null;

function getGenerationQueue(): Queue<ContentBatchGenerationJobPayload> {
  if (!generationQueue) {
    generationQueue = new Queue<ContentBatchGenerationJobPayload>(
      CONTENT_BATCH_GENERATE_QUEUE,
      {
        connection: getRedis(),
        prefix: getBullMqPrefix(),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 50,
        },
      }
    );
  }
  return generationQueue;
}

const queueMonthlyBatchImpl = async (
  input: ContentBatchGenerationJobPayload
): Promise<Result<{ jobId: string }>> => {
  const parsed = contentBatchGenerationJobSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const payload = parsed.data;
  const jobId = safeJobId('content-batch', payload.batchId);

  try {
    const queue = getGenerationQueue();
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        return ok({ jobId });
      }
    }

    const job = await queue.add('generate', payload, {
      jobId,
      // Fresh/replaced batches can be reset safely between attempts. Appends
      // may contain already-reviewed sibling content, so never auto-retry an
      // append in a way that could duplicate positions.
      attempts: payload.markFailedOnError ? 3 : 1,
    });
    return ok({ jobId: job.id ?? jobId });
  } catch (error) {
    logError('contentBatches.queueMonthlyBatch', error, {
      feature: 'content-batches',
      extra: {
        batchId: payload.batchId,
        organizationId: payload.organizationId,
      },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue content generation. Please try again.'
      )
    );
  }
};

export const queueMonthlyBatch = (input: ContentBatchGenerationJobPayload) =>
  trackedResult(
    'contentBatches.queueMonthlyBatch',
    () => queueMonthlyBatchImpl(input),
    {
      properties: {
        batchId: input.batchId,
        organizationId: input.organizationId,
      },
    }
  );

export async function closeMonthlyBatchQueue(): Promise<void> {
  if (generationQueue) {
    await generationQueue.close();
    generationQueue = null;
  }
}
