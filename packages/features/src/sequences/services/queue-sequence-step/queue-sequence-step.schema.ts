import { z } from 'zod';

/**
 * Queue names for sequence execution
 */
export const SEQUENCE_EXECUTION_QUEUE = 'sequence-execution';
export const SEQUENCE_EXECUTION_DLQ = 'sequence-execution-dlq';

/**
 * Schema for sequence step job payload
 */
export const sequenceStepJobPayloadSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Step ID - if undefined, starts from first step */
  stepId: z.string().optional(),
});

export type SequenceStepJobPayload = z.infer<
  typeof sequenceStepJobPayloadSchema
>;

/**
 * Schema for queueing a sequence step
 */
export const queueSequenceStepSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  stepId: z.string().optional(),
  /** Delay in milliseconds before executing this step */
  delayMs: z.number().int().min(0).default(0),
});

export type QueueSequenceStepInput = z.infer<typeof queueSequenceStepSchema>;

/**
 * Schema for queueing the first step of a sequence
 */
export const queueFirstStepSchema = z.object({
  leadId: z.string().min(1, 'Lead ID is required'),
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Delay in milliseconds before executing first step (default: 0 for immediate) */
  delayMs: z.number().int().min(0).default(0),
});

export type QueueFirstStepInput = z.infer<typeof queueFirstStepSchema>;
