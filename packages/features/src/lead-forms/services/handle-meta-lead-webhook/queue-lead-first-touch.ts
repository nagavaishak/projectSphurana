import { logError } from '@borradh-workspace/observability';

import { enqueueJob, leadFirstTouchJob } from '../../../jobs/index.js';
import { safeJobId } from '../../../shared/queue/index.js';

/**
 * Enqueue Claire's opening message for a freshly-created lead.
 *
 * Best-effort by design: a queue failure must never fail lead ingestion. Losing
 * the opener costs one un-greeted lead that a human can still pick up; failing
 * the webhook makes Meta retry the whole batch and risks duplicating leads.
 *
 * The job id is derived from the lead, so a Meta webhook retry collapses onto
 * the same job instead of queueing a second opener.
 */
export async function queueLeadFirstTouchSafe(
  input: {
    organizationId: string;
    leadId: string;
    facebookLeadId: string | null;
  },
  options: {
    /**
     * Milliseconds to hold the opener before it sends.
     *
     * Zero on the live path — a lead that just submitted should hear back at
     * once. A backfill sets an increasing delay per lead so recovering
     * hundreds at a time does not fire hundreds of openers in one burst: that
     * trips provider rate limits, risks the WABA being flagged for a spike of
     * business-initiated sends, and lands every reply on the clinic at once.
     */
    delayMs?: number;
  } = {}
): Promise<void> {
  try {
    await enqueueJob(
      leadFirstTouchJob,
      { ...input, step: 'opener', conversationId: null },
      {
        jobId: safeJobId('first-touch', input.leadId, 'opener'),
        ...(options.delayMs ? { delay: options.delayMs } : {}),
      }
    );
  } catch (error) {
    logError('leadForms.queueLeadFirstTouch', error, {
      feature: 'lead-forms',
      extra: { organizationId: input.organizationId, leadId: input.leadId },
    });
  }
}
