import { logError } from '@borradh-workspace/observability';

import { enqueueJob, leadFirstTouchJob } from '../../../jobs/index.js';
import { safeJobId } from '../../../shared/queue/index.js';

/** Nudge at 4h, then once more at 24h, then stop. */
export const FOLLOW_UP_DELAYS_MS = {
  followup_1: 4 * 60 * 60 * 1000,
  followup_2: 24 * 60 * 60 * 1000,
} as const;

/**
 * Schedule both nudges for a lead who has just received an opener.
 *
 * Both are scheduled now rather than chaining the second off the first: each
 * checks at fire time whether the lead has replied, so a 4h job that fails or
 * is lost cannot silently swallow the 24h one.
 *
 * Job ids are derived from the lead, so a redelivered opener cannot schedule a
 * second set of nudges.
 *
 * Best-effort: a lead who got the opener but no nudges is a worse outcome than
 * one who got neither, but not a reason to report the opener as failed.
 */
export async function scheduleFollowUps(input: {
  organizationId: string;
  leadId: string;
  conversationId: string;
}): Promise<void> {
  for (const step of ['followup_1', 'followup_2'] as const) {
    try {
      await enqueueJob(
        leadFirstTouchJob,
        {
          organizationId: input.organizationId,
          leadId: input.leadId,
          conversationId: input.conversationId,
          facebookLeadId: null,
          step,
        },
        {
          jobId: safeJobId('first-touch', input.leadId, step),
          delay: FOLLOW_UP_DELAYS_MS[step],
        }
      );
    } catch (error) {
      logError('conversations.scheduleFollowUps', error, {
        feature: 'conversations',
        extra: { leadId: input.leadId, step },
      });
    }
  }
}
