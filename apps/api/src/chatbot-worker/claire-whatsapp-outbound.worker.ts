import {
  CLAIRE_WHATSAPP_OUTBOUND_QUEUE,
  type ClaireWhatsappOutboundJobPayload,
} from '@borradh-workspace/features/assistant';
import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';
import { processClaireWhatsappOutbound } from './claire-whatsapp-outbound.process.js';

const logger = createLogger('ClaireWhatsappOutboundWorker');

/**
 * BullMQ worker for proactive/async outbound deliveries to paired
 * Claire-on-WhatsApp owners (finished video renders, etc.).
 *
 * Distinct from the inbound turn worker: it runs no Claire turn, just pushes
 * already-composed bubbles. Idempotency is handled at enqueue time via the
 * producer's `dedupeKey` → jobId, so no per-conversation lock is needed here.
 */
export function createClaireWhatsappOutboundWorker(): Worker {
  const worker = new Worker<ClaireWhatsappOutboundJobPayload>(
    CLAIRE_WHATSAPP_OUTBOUND_QUEUE,
    async (job: Job<ClaireWhatsappOutboundJobPayload>) => {
      logger.info('Processing Claire WhatsApp outbound', {
        jobId: job.id,
        organizationId: job.data.organizationId,
        conversationId: job.data.conversationId,
      });
      await processClaireWhatsappOutbound(job.data);
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 4,
    }
  );

  worker.on('failed', (job, error) => {
    logError('assistant.claireWhatsappOutboundWorker.jobFailed', error, {
      feature: 'assistant',
      extra: {
        jobId: job?.id,
        organizationId: job?.data?.organizationId,
        attemptsMade: job?.attemptsMade,
      },
    });
  });

  worker.on('error', (error) => {
    logError('assistant.claireWhatsappOutboundWorker.error', error, {
      feature: 'assistant',
    });
  });

  return worker;
}
