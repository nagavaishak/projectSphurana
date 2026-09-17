import { z } from 'zod';
import { type JobInput, type JobOutput, defineJob } from '../define-job.js';
import { leadFirstTouchQueue } from '../queues.js';

/**
 * THE `lead-first-touch` payload — Claire's opening message to a lead who has
 * just submitted a Meta lead form.
 *
 * `leadId` alone would be enough to re-read everything, and that is deliberate:
 * the job carries the ids, not the copy. The message is composed at send time
 * from the lead and the org, so a job sitting in Redis across a deploy cannot
 * deliver stale wording.
 */
export const leadFirstTouchPayloadSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1),
  /**
   * Which lead-form submission triggered this. Only used for tracing back to
   * the webhook that caused a send.
   */
  facebookLeadId: z.string().nullable(),
  /**
   * Which message in the sequence this job sends. The opener schedules the
   * nudges, so one queue and one payload cover the whole sequence.
   */
  step: z.enum(['opener', 'followup_1', 'followup_2']),
  /** Set for the nudges — the conversation the opener created. */
  conversationId: z.string().nullable(),
});

export const leadFirstTouchJob = defineJob({
  queue: leadFirstTouchQueue,
  name: 'first-touch',
  payload: leadFirstTouchPayloadSchema,
  legacyDefaults: {
    facebookLeadId: null,
    step: 'opener',
    conversationId: null,
  },
});

export type LeadFirstTouchJobInput = JobInput<typeof leadFirstTouchJob>;
export type LeadFirstTouchJobPayload = JobOutput<typeof leadFirstTouchJob>;
