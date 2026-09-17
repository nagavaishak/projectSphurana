/**
 * `queueDuplicateCampaign` — enqueue a campaign duplication onto the
 * `meta-campaign-duplicate` BullMQ queue so the (potentially long) sequence of
 * Meta `/copies` calls runs on the worker fleet instead of on the API request
 * path.
 *
 * Why: duplicating a campaign copies the campaign, every ad set and every ad
 * one object at a time (Meta's synchronous deep-copy caps at <3 objects). For a
 * campaign with several ads that's many sequential Meta calls — far too long to
 * hold an API request (and its DB connection) open. The worker runs it under the
 * transaction-free SYSTEM scope.
 *
 * The consumer lives in `apps/video-worker/src/meta-campaign-duplicate-processor.ts`.
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
  META_CAMPAIGN_DUPLICATE_QUEUE,
  type QueueDuplicateCampaignInput,
  queueDuplicateCampaignSchema,
} from './queue-duplicate-campaign.schema.js';

let duplicateQueue: Queue | null = null;

// Duplication is user-triggered and not idempotent on retry (a retry would
// create a second copy), so do not auto-retry — surface the failure instead.
const RETRY_CONFIG = {
  attempts: 1,
};

function getDuplicateQueue(): Queue {
  if (!duplicateQueue) {
    duplicateQueue = new Queue(META_CAMPAIGN_DUPLICATE_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: 50,
        ...RETRY_CONFIG,
      },
    });
  }
  return duplicateQueue;
}

const queueDuplicateCampaignImpl = async (
  input: QueueDuplicateCampaignInput
): Promise<
  Result<{ jobId: string; metaCampaignId: string; queued: boolean }>
> => {
  const parsed = queueDuplicateCampaignSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaCampaignId } = parsed.data;

  try {
    const queue = getDuplicateQueue();
    const jobId = `meta-campaign-duplicate-${metaCampaignId}`;

    // The per-campaign jobId collapses repeat clicks while a copy is in flight.
    // But a *terminal* job (failed — kept by removeOnFail — or a not-yet-removed
    // completed one) keeps that jobId occupied, and BullMQ silently ignores a
    // re-add with an existing id. So: if a prior job for this campaign is
    // finished, drop it so a fresh run can be enqueued; if it's still
    // waiting/active, collapse onto it instead of stacking a duplicate.
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'completed' || state === 'failed') {
        await existing.remove();
      } else {
        return ok({ jobId, metaCampaignId, queued: true });
      }
    }

    const job = await queue.add('duplicate', parsed.data, { jobId });
    return ok({
      jobId: job.id ?? jobId,
      metaCampaignId,
      queued: true,
    });
  } catch (error) {
    logError('metaCampaigns.queueDuplicateCampaign', error, {
      feature: 'meta-campaigns',
      extra: { organizationId, metaCampaignId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue campaign duplication'
      )
    );
  }
};

export const queueDuplicateCampaign = (input: QueueDuplicateCampaignInput) =>
  trackedResult(
    'metaCampaigns.queueDuplicateCampaign',
    () => queueDuplicateCampaignImpl(input),
    {
      properties: {
        organizationId: input.organizationId,
        metaCampaignId: input.metaCampaignId,
      },
    }
  );

export type QueueDuplicateCampaignResult = Awaited<
  ReturnType<typeof queueDuplicateCampaign>
>;

/** Close the queue connection (graceful shutdown). */
export async function closeDuplicateCampaignQueue(): Promise<void> {
  if (duplicateQueue) {
    await duplicateQueue.close();
    duplicateQueue = null;
  }
}
