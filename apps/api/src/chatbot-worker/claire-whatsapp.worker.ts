import {
  CLAIRE_WHATSAPP_TURN_QUEUE,
  type ClaireWhatsappTurnJobPayload,
} from '@borradh-workspace/features/assistant';
import { acquireConversationLock } from '@borradh-workspace/features/chatbots';
import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { DelayedError, type Job, Worker } from 'bullmq';
import {
  buildClaireWhatsappService,
  processClaireWhatsappTurn,
} from './claire-whatsapp-turn.process.js';

const logger = createLogger('ClaireWhatsappWorker');

/**
 * BullMQ worker for inbound Claire-on-WhatsApp owner turns (WS-10).
 *
 * Mirrors the chatbot-flow worker pattern (createX → new Worker → event
 * handlers). Concurrency is low (a Claire turn runs the full Anthropic tool
 * loop ≤10 rounds + media resolution) and a per-conversation Redis lock (reused
 * from the chatbot pipeline) prevents two of the owner's messages from running
 * concurrently against the same thread.
 */
export function createClaireWhatsappWorker(): Worker {
  const worker = new Worker<ClaireWhatsappTurnJobPayload>(
    CLAIRE_WHATSAPP_TURN_QUEUE,
    async (job: Job<ClaireWhatsappTurnJobPayload>) => {
      logger.info('Processing Claire WhatsApp turn', {
        jobId: job.id,
        organizationId: job.data.organizationId,
      });

      // Per-(user,org) lock so the owner's rapid-fire messages serialize on
      // their single whatsapp thread. We key on the stable (userId, org) pair
      // since the conversation id is resolved inside the process function.
      const lockKey = `claire-wa:${job.data.userId}:${job.data.organizationId}`;
      const lock = await acquireConversationLock(lockKey, 120000);
      if (!lock.acquired) {
        // Another turn for this owner is in flight. This is expected under
        // rapid-fire messages, not a failed Claire turn: defer the existing
        // job without consuming a retry or emitting a `failed` event (which
        // would incorrectly page Sentry).
        const retryAt = Date.now() + 5_000;
        await job.moveToDelayed(retryAt, job.token);
        logger.info('Claire WhatsApp turn lock busy; deferred', {
          jobId: job.id,
          retryAt: new Date(retryAt).toISOString(),
        });
        // BullMQ requires this sentinel after an active job is moved to the
        // delayed set so it does not subsequently mark it as completed.
        throw new DelayedError();
      }

      try {
        await processClaireWhatsappTurn(job.data);
      } catch (error) {
        // Send a graceful fallback so the owner never gets silence.
        try {
          const service = buildClaireWhatsappService();
          await service.sendTextMessage(
            job.data.fromPhoneE164,
            "Sorry, I'm having trouble right now — please try again in a minute."
          );
        } catch {
          // Best-effort; if the fallback also fails, BullMQ retry is the backstop.
        }
        throw error;
      } finally {
        await lock.release();
      }
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      // Tool loops are slow + token-heavy; keep concurrency modest.
      concurrency: 4,
    }
  );

  worker.on('completed', (job) => {
    logger.debug('Claire WhatsApp turn completed', { jobId: job.id });
  });

  worker.on('failed', (job, error) => {
    logError('assistant.claireWhatsappWorker.jobFailed', error, {
      feature: 'assistant',
      extra: {
        jobId: job?.id,
        organizationId: job?.data?.organizationId,
        attemptsMade: job?.attemptsMade,
      },
    });
  });

  worker.on('error', (error) => {
    logError('assistant.claireWhatsappWorker.error', error, {
      feature: 'assistant',
    });
  });

  return worker;
}
