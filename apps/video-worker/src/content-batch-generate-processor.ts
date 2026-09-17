import { contentBatch, db, withSystemScope } from '@borradh-workspace/database';
import {
  CONTENT_BATCH_GENERATE_QUEUE,
  type ContentBatchGenerationJobPayload,
  type PreparedMonthlyBatch,
  prepareMonthlyBatch,
  seedMonthlyBatch,
} from '@borradh-workspace/features/content-batches';
import {
  isTerminalFailure,
  moveToDeadLetter,
} from '@borradh-workspace/features/shared/queue';
import {
  type Logger,
  createLogger,
  logError,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Worker } from 'bullmq';
import { and, eq } from 'drizzle-orm';

const CONCURRENCY = 2;
let log: Logger;

export function createContentBatchGenerateWorker(): Worker<ContentBatchGenerationJobPayload> {
  log = createLogger('content-batch-generate');
  log.info(`Starting content batch worker, concurrency: ${CONCURRENCY}`);

  const worker = new Worker<ContentBatchGenerationJobPayload>(
    CONTENT_BATCH_GENERATE_QUEUE,
    async (job) => {
      const payload = job.data;
      const result = await withSystemScope(
        async (conn) => {
          let batch = await conn.query.contentBatch.findFirst({
            where: and(
              eq(contentBatch.id, payload.batchId),
              eq(contentBatch.organizationId, payload.organizationId)
            ),
          });
          if (!batch) {
            throw new Error('Prepared content batch no longer exists');
          }

          // A worker/process crash can happen after only some slots were seeded.
          // Before BullMQ retries a replace/fresh run, clear that partial attempt
          // with the same preparation path so retries remain idempotent.
          // Annotated rather than inferred: the retry branch below reassigns
          // this from prepareMonthlyBatch, whose `shouldSeed` is a boolean. An
          // inferred `true` literal would reject that assignment.
          let prepared: PreparedMonthlyBatch = {
            ...payload,
            batch,
            shouldSeed: true,
          };
          if (job.attemptsMade > 0 && payload.markFailedOnError) {
            const reset = await prepareMonthlyBatch(conn, {
              organizationId: payload.organizationId,
              periodMonth: payload.periodMonth,
              createdById: payload.createdById,
              graphicCount: payload.graphicCount,
              videoCount: payload.videoCount,
              serviceIds: payload.serviceIds,
              allowStockFootage: payload.allowStockFootage,
              replace: true,
            });
            if (!reset.success) return reset;
            batch = reset.data.batch;
            prepared = reset.data;
          }

          // BullMQ owns retry exhaustion for this path. Keep the batch in
          // planning during recoverable attempts; the terminal `failed`
          // listener below is the single place that persists a failed state.
          return seedMonthlyBatch(conn, {
            ...prepared,
            markFailedOnError: false,
          });
        },
        { db }
      );

      if (!result.success) {
        throw new Error(result.error.message);
      }
      log.info(
        `Generated batch ${payload.batchId}: ${result.data.graphicsSeeded} graphics, ${result.data.videosSeeded} videos`
      );
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: CONCURRENCY,
      lockDuration: 300000,
      stalledInterval: 60000,
    }
  );

  worker.on('ready', () => log.info('Worker ready and listening for jobs'));
  worker.on('failed', (job, error) => {
    logError('video-worker.contentBatchGenerate.jobFailed', error, {
      feature: 'video-worker',
      extra: {
        jobId: job?.id,
        batchId: job?.data.batchId,
        organizationId: job?.data.organizationId,
        attemptsMade: job?.attemptsMade,
      },
    });
    if (!job || !isTerminalFailure(job)) return;

    // Only fresh/replace runs own the whole batch and may flip it to `failed`.
    // Append jobs (`markFailedOnError: false`) run against a batch that can
    // already hold reviewed/scheduled items — clobbering it to `failed` would
    // discard the owner's approved content. For those, we still dead-letter for
    // visibility but leave the batch status untouched.
    if (job.data.markFailedOnError) {
      const userFacingError =
        'BATCH_GENERATION_FAILED: Content generation failed after 3 attempts. Please try again.';
      void withSystemScope(
        (conn) =>
          conn
            .update(contentBatch)
            .set({
              status: 'failed',
              errorMessage: userFacingError,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(contentBatch.id, job.data.batchId),
                eq(contentBatch.organizationId, job.data.organizationId)
              )
            ),
        { db }
      ).catch((persistError) => {
        logError(
          'video-worker.contentBatchGenerate.persistTerminalFailure',
          persistError,
          {
            feature: 'video-worker',
            extra: { batchId: job.data.batchId, jobId: job.id },
          }
        );
      });
    }
    void moveToDeadLetter({
      queueName: CONTENT_BATCH_GENERATE_QUEUE,
      job,
      error,
      context: {
        batchId: job.data.batchId,
        organizationId: job.data.organizationId,
      },
    });
  });

  return worker;
}

export async function closeContentBatchGenerateWorker(
  worker: Worker<ContentBatchGenerationJobPayload>
): Promise<void> {
  await worker.close();
}
