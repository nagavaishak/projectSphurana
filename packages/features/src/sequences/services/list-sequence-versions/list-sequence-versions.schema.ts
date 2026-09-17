import { z } from 'zod';

export const listSequenceVersionsSchema = z.object({
  sequenceId: z.string().min(1, 'Sequence ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListSequenceVersionsInput = z.infer<
  typeof listSequenceVersionsSchema
>;
