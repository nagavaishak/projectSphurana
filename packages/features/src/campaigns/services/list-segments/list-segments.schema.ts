import { z } from 'zod';

export const listSegmentsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export type ListSegmentsInput = z.infer<typeof listSegmentsSchema>;
