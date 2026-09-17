import { z } from 'zod';

export const listSequencesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  isActive: z.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListSequencesInput = z.infer<typeof listSequencesSchema>;
