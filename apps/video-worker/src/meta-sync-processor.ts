/**
 * meta-sync worker — runs `syncMetaData` (the Meta Graph API → local DB sync)
 * off the API request path.
 *
 * Why this exists: `syncMetaData` makes sequential Meta Graph API calls that
 * take ~11-12s. Run inline on `POST /meta-campaigns/sync-all` (which the app
 * fires on every fresh session) those long requests pin the API's small DB pool
 * and starve interactive traffic. Here it runs on the worker fleet under the
 * transaction-free SYSTEM scope (`withSystemScope` opens no transaction, RLS on
 * or off), so it never holds a DB connection across the Meta calls.
 *
 * Producer: `packages/features/src/meta-sync/services/queue-meta-sync`.
 */

import { db, withSystemScope } from '@borradh-workspace/database';
import { AdErrorCodes } from '@borradh-workspace/features/meta-ads';
import {
  META_SYNC_QUEUE,
  type MetaSyncJobPayload,
  syncMetaData,
} from '@borradh-workspace/features/meta-sync';
import {
  type Logger,
  createLogger,
  logError,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Worker } from 'bullmq';

// Meta sync is light on CPU (mostly awaiting Meta + short DB writes) and is
// throttled per-org (5 min) with a per-org jobId, so a handful in parallel is
// plenty.
const META_SYNC_CONCURRENCY = 5;

let log: Logger;

export function createMetaSyncWorker(): Worker<MetaSyncJobPayload> {
  log = createLogger('meta-sync');

  const redis = getRedis();

  log.info(
    `Starting meta-sync worker with concurrency: ${META_SYNC_CONCURRENCY}`
  );

  const worker = new Worker<MetaSyncJobPayload>(
    META_SYNC_QUEUE,
    async (job) => {
      const { organizationId, userId, force } = job.data;

      // SYSTEM scope: cross-org worker path. With RLS on this runs on the
      // BYPASSRLS app_system pool and — crucially — opens NO transaction, so
      // the Meta Graph calls inside syncMetaData are never spanned by a held
      // connection. With RLS off it is a plain passthrough.
      const result = await withSystemScope(
        (conn) => syncMetaData(conn, { organizationId, userId, force }),
        { db }
      );

      if (!result.success) {
        // Dead/revoked token (Meta code 190 → META_AUTH_EXPIRED): an expected,
        // user-side condition already surfaced via needs_reconnect. Warn, don't
        // page — and return (no throw), so `worker.on('failed')` never fires
        // and can't double-report it.
        if (result.error.code === AdErrorCodes.META_AUTH_EXPIRED) {
          log.warn(
            `Job ${job.id} skipped org ${organizationId}: Meta token needs reconnect (${result.error.message})`
          );
          return;
        }
        logError('video-worker.metaSync.processJob', result.error, {
          feature: 'video-worker',
          extra: { jobId: job.id, organizationId, code: result.error.code },
        });
        // Let BullMQ retry transient (DB/Meta) failures; terminal ones
        // (validation, integration gone) shouldn't burn a retry.
        if (result.error.code === 'INTERNAL_ERROR') {
          throw new Error(`meta-sync failed: ${result.error.message}`);
        }
        return;
      }

      log.info(
        `Job ${job.id} synced org ${organizationId}${
          result.data.skipped ? ' (throttled)' : ''
        }`
      );
    },
    {
      connection: redis,
      prefix: getBullMqPrefix(),
      concurrency: META_SYNC_CONCURRENCY,
      // Two sequential Meta GETs at up to 20s each + DB writes. 2 min of lock
      // keeps stalled-detection from firing on a healthy-but-slow sync.
      lockDuration: 120000,
      stalledInterval: 60000,
    }
  );

  worker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });

  worker.on('failed', (job, error) => {
    logError('video-worker.metaSync.jobFailed', error, {
      feature: 'video-worker',
      extra: { jobId: job?.id, organizationId: job?.data.organizationId },
    });
  });

  return worker;
}

export async function closeMetaSyncWorker(
  worker: Worker<MetaSyncJobPayload>
): Promise<void> {
  await worker.close();
}
