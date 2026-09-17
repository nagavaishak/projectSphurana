import { db, withSystemScope } from '@borradh-workspace/database';
import {
  createDocumentMediaDeps,
  processDocumentImportJob,
} from '@borradh-workspace/features/document-imports';
import {
  type DocumentMatchJobPayload,
  documentMatchJob,
  documentMatchQueue,
  parseJobData,
} from '@borradh-workspace/features/jobs';
import {
  isTerminalFailure,
  moveToDeadLetter,
} from '@borradh-workspace/features/shared/queue';
import { createLogger, logError } from '@borradh-workspace/observability';
import {
  getBullMqPrefix,
  getRedis,
  isTransientRedisError,
} from '@borradh-workspace/redis';
import {
  copy,
  deleteObject,
  downloadAsBuffer,
  getMetadata,
  getOrgAssetsBucket,
  getPresignedUploadUrl,
  getS3Region,
} from '@borradh-workspace/storage';
import { type Job, Worker } from 'bullmq';

const logger = createLogger('DocumentMatchWorker');

/**
 * Worker for `document-match` (ENG-784): reads one staged document with the
 * vision model and files it against the matching client.
 *
 * One job is up to two model calls (extract, then adjudicate when the
 * candidates are ambiguous) plus an S3 download, a PDF rasterisation and an
 * S3 copy. `lockDuration` is sized for the slow path so BullMQ renews the
 * lock instead of racing stalled-job recovery (the lock-mismatch failure the
 * Claire classifier hit). Concurrency 1: rasterising runs on this process's
 * event loop, which also serves HTTP.
 */
export function createDocumentMatchWorker(): Worker {
  const deps = {
    storage: {
      getOrgAssetsBucket,
      getS3Region,
      getPresignedUploadUrl,
      getMetadata,
      downloadAsBuffer,
      copy,
      deleteObject,
    },
    media: createDocumentMediaDeps(),
  };

  const worker = new Worker<DocumentMatchJobPayload>(
    documentMatchQueue.name,
    async (job: Job<DocumentMatchJobPayload>) => {
      const data = parseJobData(documentMatchJob, job.data);
      const outcome = await withSystemScope(
        (conn) => processDocumentImportJob(conn, deps, data),
        { db }
      );
      logger.info('Document match processed', {
        jobId: job.id,
        importId: data.importId,
        organizationId: data.organizationId,
        outcome,
      });
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      lockDuration: 180_000,
      stalledInterval: 30_000,
      maxStalledCount: 1,
      concurrency: 1,
    }
  );

  worker.on('failed', async (job, error) => {
    logError('documentImports.matchWorker.jobFailed', error, {
      feature: 'document-imports',
      extra: {
        jobId: job?.id,
        importId: job?.data?.importId,
        organizationId: job?.data?.organizationId,
        attemptsMade: job?.attemptsMade,
      },
    });
    // The row is already marked `failed` by the handler; the DLQ copy is for
    // replay once whatever broke the model/S3 path is fixed.
    if (job && isTerminalFailure(job)) {
      await moveToDeadLetter({
        queueName: documentMatchQueue.name,
        job,
        error,
        context: {
          importId: job.data?.importId,
          organizationId: job.data?.organizationId,
        },
      });
    }
  });

  worker.on('stalled', (jobId) => {
    logError(
      'documentImports.matchWorker.jobStalled',
      new Error('Document match job stalled and will be recovered'),
      { feature: 'document-imports', extra: { jobId } }
    );
  });

  worker.on('error', (error) => {
    if (isTransientRedisError(error)) {
      logger.warn('Transient Redis error (auto-recovering)', {
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    logError('documentImports.matchWorker.error', error, {
      feature: 'document-imports',
    });
  });

  return worker;
}
