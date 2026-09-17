import { z } from 'zod';
import { type JobInput, type JobOutput, defineJob } from '../define-job.js';
import { documentMatchQueue } from '../queues.js';

/**
 * THE `document-match` payload — one staged document to read and attach to a
 * client (ENG-784).
 *
 * Ids only. The worker re-reads the `document_import` row (file, org, status)
 * so a job that sits in Redis across a deploy can never act on stale facts,
 * and `organizationId` travels alongside `importId` so every query in the
 * system-scoped handler can pin the org explicitly.
 */
export const documentMatchPayloadSchema = z.object({
  organizationId: z.string().min(1),
  importId: z.string().min(1),
});

export const documentMatchJob = defineJob({
  queue: documentMatchQueue,
  name: 'match',
  payload: documentMatchPayloadSchema,
});

export type DocumentMatchJobInput = JobInput<typeof documentMatchJob>;
export type DocumentMatchJobPayload = JobOutput<typeof documentMatchJob>;
