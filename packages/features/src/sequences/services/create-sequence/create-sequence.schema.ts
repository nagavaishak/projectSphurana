import { z } from 'zod';

/**
 * Schema for creating a new sequence
 */
export const createSequenceSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Sequence name is required'),
  description: z.string().optional(),
  isActive: z.boolean().optional().default(false),
  triggerOnNewLead: z.boolean().optional().default(true),
  scheduleNextDay: z.boolean().optional().default(false),
  nodes: z.array(z.any()).optional(),
  edges: z.array(z.any()).optional(),
  createdById: z.string().optional(),
});

/**
 * Input type (what callers provide - optional fields are optional)
 */
export type CreateSequenceInput = z.input<typeof createSequenceSchema>;

/**
 * Output type (after defaults applied - all fields present)
 */
export type CreateSequenceParsed = z.output<typeof createSequenceSchema>;
