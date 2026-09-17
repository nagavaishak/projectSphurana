import { db } from '@borradh-workspace/database';
import {
  sendLeadFirstTouch,
  sendLeadFollowUp,
} from '@borradh-workspace/features/conversations';
import {
  type LeadFirstTouchJobPayload,
  leadFirstTouchJob,
  leadFirstTouchQueue,
  parseJobData,
} from '@borradh-workspace/features/jobs';
import { createLogger, logError } from '@borradh-workspace/observability';
import { getBullMqPrefix, getRedis } from '@borradh-workspace/redis';
import { type Job, Worker } from 'bullmq';

const logger = createLogger('LeadFirstTouchWorker');

/**
 * Worker for `lead-first-touch` — Claire's opening message to a new lead-form
 * submission.
 *
 * Concurrency is deliberately low: each job ends in an external provider send,
 * and the whole point of the feature is a reply within 60 seconds, not maximum
 * throughput. The queue is declared `attempts: 1` (see the registry), so a
 * failure here is terminal and lands in the DLQ rather than re-messaging the
 * lead.
 */
export function createLeadFirstTouchWorker(): Worker {
  const worker = new Worker<LeadFirstTouchJobPayload>(
    leadFirstTouchQueue.name,
    async (job: Job<LeadFirstTouchJobPayload>) => {
      const data = parseJobData(leadFirstTouchJob, job.data);

      const result =
        data.step === 'opener'
          ? await sendLeadFirstTouch(db, {
              organizationId: data.organizationId,
              leadId: data.leadId,
            })
          : data.conversationId
            ? await sendLeadFollowUp(db, {
                organizationId: data.organizationId,
                leadId: data.leadId,
                conversationId: data.conversationId,
                step: data.step,
              })
            : // A nudge with no conversation cannot be sent or checked for a
              // reply. Drop it rather than guess which conversation it meant.
              null;

      if (result && !result.success) {
        // Throw so the job is recorded as failed and reaches the DLQ — a
        // silent return would look like a delivered opener.
        throw new Error(result.error.message);
      }

      logger.info('First touch processed', {
        jobId: job.id,
        leadId: data.leadId,
        step: data.step,
        ...(result?.success && result.data.sent
          ? { sent: true }
          : { sent: false }),
      });
    },
    {
      connection: getRedis(),
      prefix: getBullMqPrefix(),
      concurrency: 5,
    }
  );

  worker.on('failed', (job, error) => {
    logError('leadFirstTouch.worker', error, {
      feature: 'conversations',
      extra: { jobId: job?.id, leadId: job?.data?.leadId },
    });
  });

  return worker;
}
