import { z } from 'zod';

export const createSequenceVersionSchema = z.object({
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  nodes: z.array(z.unknown()),
  edges: z.array(z.unknown()),
  changeType: z.enum(['created', 'updated', 'published', 'restored']),
  changeSummary: z.string().optional(),
});

export type CreateSequenceVersionInput = z.infer<
  typeof createSequenceVersionSchema
>;
