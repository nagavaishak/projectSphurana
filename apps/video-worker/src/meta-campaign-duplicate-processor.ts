/**
 * meta-campaign-duplicate worker — runs `duplicateCampaign` (the Meta `/copies`
 * sequence) off the API request path.
 *
 * Why this exists: duplicating a campaign copies the campaign, each ad set and
 * each ad one object at a time (Meta's synchronous deep-copy caps at <3
 * objects), so a campaign with several ads is many sequential Meta calls —
 * far too long to hold an API request open. Here it runs on the worker fleet
 * under the transaction-free SYSTEM scope.
 *
 * Producer: `packages/features/src/meta-campaigns/services/queue-duplicate-campaign`.
 */

import { db, withSystemScope } from '@borradh-workspace/database';
import {
  type DuplicateCampaignJobPayload,
  META_CAMPAIGN_DUPLICATE_QUEUE,
  duplicateCampaign,
} from '@borradh-workspace/features/meta-campaigns';
import {
  type Logger,
  createLogger,
  logError,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { Worker } from 'bullmq';

// User-triggered and low-frequency; a few in parallel is plenty.
const CONCURRENCY = 3;

let log: Logger;

export function createMetaCampaignDuplicateWorker(): Worker<DuplicateCampaignJobPayload> {
  log = createLogger('meta-campaign-duplicate');

  log.info(
    `Starting meta-campaign-duplicate worker, concurrency: ${CONCURRENCY}`
  );

  const worker = new Worker<DuplicateCampaignJobPayload>(
    META_CAMPAIGN_DUPLICATE_QUEUE,
    async (job) => {
      const { organizationId, metaCampaignId } = job.data;

      // SYSTEM scope: cross-org worker path, opens no transaction so the long
      // run of Meta Graph calls is never spanned by a held API connection.
      const result = await withSystemScope(
        (conn) => duplicateCampaign(conn, { organizationId, metaCampaignId }),
        { db }
      );

      if (!result.success) {
        logError(
          'video-worker.metaCampaignDuplicate.processJob',
          result.error,
          {
            feature: 'video-worker',
            extra: {
              jobId: job.id,
              organizationId,
              metaCampaignId,
              code: result.error.code,
            },
          }
        );
        // Surface terminal failures to BullMQ (no auto-retry is configured).
        throw new Error(`campaign duplication failed: ${result.error.message}`);
      }

      log.info(
        `Job ${job.id} duplicated campaign ${metaCampaignId} → ${result.data.metaCampaignId} (${result.data.adsCopied} ads)`
      );
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: CONCURRENCY,
      // Many sequential Meta calls (one per ad object). Keep the lock generous
      // so stalled-detection doesn't fire on a healthy-but-slow large copy.
      lockDuration: 300000,
      stalledInterval: 60000,
    }
  );

  worker.on('ready', () => {
    log.info('Worker ready and listening for jobs');
  });

  worker.on('failed', (job, error) => {
    logError('video-worker.metaCampaignDuplicate.jobFailed', error, {
      feature: 'video-worker',
      extra: {
        jobId: job?.id,
        organizationId: job?.data.organizationId,
        metaCampaignId: job?.data.metaCampaignId,
      },
    });
  });

  return worker;
}

export async function closeMetaCampaignDuplicateWorker(
  worker: Worker<DuplicateCampaignJobPayload>
): Promise<void> {
  await worker.close();
}
