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
import { safeJobId } from '../../../shared/queue/index.js';
import {
  type QueueVoiceIngestInput,
  VOICE_INGEST_QUEUE,
  type VoiceIngestJobPayload,
  queueVoiceIngestSchema,
} from './queue-voice-ingest.schema.js';

const logger = createLogger('QueueVoiceIngest');

// Lazy-initialized queue
let _voiceIngestQueue: Queue | null = null;

function getQueue(): Queue {
  if (!_voiceIngestQueue) {
    _voiceIngestQueue = new Queue(VOICE_INGEST_QUEUE, {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      defaultJobOptions: {
        // PRD-40: was attempts:1 — a single transient blip (network, Meta API,
        // S3) meant total loss of the ingest. Retry with exponential backoff.
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        removeOnComplete: {
          count: 200,
        },
        removeOnFail: {
          count: 100,
        },
      },
    });
  }
  return _voiceIngestQueue;
}

/**
 * Queue a voice ingest job.
 *
 * Job ID: `voice-ingest-{organizationId}-{metaAdsPageId}`
 * This ensures only one ingest runs per org+page at a time.
 */
const queueVoiceIngestImpl = async (
  input: QueueVoiceIngestInput
): Promise<Result<{ jobId: string }>> => {
  const parsed = queueVoiceIngestSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, metaAdsPageId, triggerReason } = parsed.data;

  try {
    const queue = getQueue();

    const jobId = safeJobId('voice-ingest', organizationId, metaAdsPageId);

    // Remove any existing failed/completed job with this ID so retries work
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') {
        await existing.remove();
      }
    }

    const jobOptions: JobsOptions = {
      jobId,
    };

    const payload: VoiceIngestJobPayload = {
      organizationId,
      metaAdsPageId,
      triggerReason,
      queuedAt: new Date().toISOString(),
    };

    const job = await queue.add('ingest', payload, jobOptions);

    logger.info('Queued voice ingest job', {
      jobId: job.id,
      organizationId,
      metaAdsPageId,
      triggerReason,
    });

    return ok({ jobId: job.id || '' });
  } catch (error) {
    logError('voiceCloning.queueVoiceIngest', error, {
      feature: 'voice-cloning',
      extra: { organizationId, metaAdsPageId, triggerReason },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue voice ingest job'
      )
    );
  }
};

export const queueVoiceIngest = (input: QueueVoiceIngestInput) =>
  trackedResult(
    'voiceCloning.queueVoiceIngest',
    () => queueVoiceIngestImpl(input),
    {
      properties: {
        organizationId: input.organizationId,
        metaAdsPageId: input.metaAdsPageId,
        triggerReason: input.triggerReason,
      },
    }
  );

/**
 * Close the queue connection (for graceful shutdown)
 */
export async function closeVoiceIngestQueue(): Promise<void> {
  if (_voiceIngestQueue) {
    await _voiceIngestQueue.close();
    _voiceIngestQueue = null;
  }
  logger.info('Voice ingest queue closed');
}

/**
 * Get the voice ingest queue for use by the worker
 */
export function getVoiceIngestQueue(): Queue {
  return getQueue();
}

export type QueueVoiceIngestResult = Awaited<
  ReturnType<typeof queueVoiceIngest>
>;
