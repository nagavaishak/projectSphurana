import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type JobsOptions, Queue } from 'bullmq';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  CAMPAIGN_SEND_DLQ,
  CAMPAIGN_SEND_QUEUE,
  type CampaignSendJobPayload,
  type EnqueueCampaignSendInput,
  enqueueCampaignSendSchema,
} from './queue-campaign-send.schema.js';

const logger = createLogger('QueueCampaignSend');

let _sendQueue: Queue | null = null;
let _dlqQueue: Queue | null = null;

function getSendQueue(): Queue {
  if (!_sendQueue) {
    _sendQueue = new Queue(CAMPAIGN_SEND_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 30000 },
        removeOnComplete: { count: 1000 },
        removeOnFail: false,
      },
    });
  }
  return _sendQueue;
}

function getDLQQueue(): Queue {
  if (!_dlqQueue) {
    _dlqQueue = new Queue(CAMPAIGN_SEND_DLQ, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        removeOnComplete: { age: 7 * 24 * 60 * 60 },
        removeOnFail: { age: 30 * 24 * 60 * 60 },
      },
    });
  }
  return _dlqQueue;
}

const enqueueCampaignSendImpl = async (
  input: EnqueueCampaignSendInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = enqueueCampaignSendSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { recipientId, organizationId, campaignId, delayMs } = parsed.data;

  try {
    const queue = getSendQueue();

    // Deterministic jobId: BullMQ dedupes a re-launch / retry while the job is
    // still tracked — a second layer on top of the DB status-claim so a
    // recipient is enqueued at most once.
    const jobOptions: JobsOptions = {
      jobId: `campaign-send:${campaignId}:${recipientId}`,
    };
    if (delayMs > 0) jobOptions.delay = delayMs;

    const job = await queue.add(
      'send',
      { recipientId, organizationId, campaignId } as CampaignSendJobPayload,
      jobOptions
    );

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('campaigns.enqueueCampaignSend', error, {
      feature: 'campaigns',
      extra: { recipientId, campaignId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to enqueue send')
    );
  }
};

export const enqueueCampaignSend = (input: EnqueueCampaignSendInput) =>
  trackedResult(
    'campaigns.enqueueCampaignSend',
    () => enqueueCampaignSendImpl(input),
    { properties: { campaignId: input.campaignId } }
  );

export interface FailedSendJobData {
  id: string;
  data: CampaignSendJobPayload;
  failedReason?: string;
  attemptsMade: number;
}

const moveToCampaignDLQImpl = async (
  data: FailedSendJobData
): Promise<Result<{ dlqJobId: string }>> => {
  try {
    const dlq = getDLQQueue();
    const job = await dlq.add(
      'failed-send',
      { ...data, failedAt: new Date().toISOString() },
      { jobId: `dlq-${data.id}` }
    );
    logger.warn('Moved campaign send to DLQ', {
      originalJobId: data.id,
      dlqJobId: job.id,
      campaignId: data.data.campaignId,
      failedReason: data.failedReason,
    });
    return ok({ dlqJobId: job.id || '' });
  } catch (error) {
    logError('campaigns.moveToCampaignDLQ', error, { feature: 'campaigns' });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to move to DLQ')
    );
  }
};

export const moveToCampaignDLQ = (data: FailedSendJobData) =>
  trackedResult('campaigns.moveToCampaignDLQ', () =>
    moveToCampaignDLQImpl(data)
  );

/** Exposed for the worker to attach a processor. */
export function getCampaignSendQueue(): Queue {
  return getSendQueue();
}

export async function closeCampaignQueues(): Promise<void> {
  if (_sendQueue) {
    await _sendQueue.close();
    _sendQueue = null;
  }
  if (_dlqQueue) {
    await _dlqQueue.close();
    _dlqQueue = null;
  }
  logger.info('Campaign queues closed');
}

export type EnqueueCampaignSendResult = Awaited<
  ReturnType<typeof enqueueCampaignSend>
>;
