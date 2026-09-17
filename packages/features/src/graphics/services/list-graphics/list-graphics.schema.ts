import { z } from 'zod';

export const listGraphicsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  status: z.enum(['draft', 'rendering', 'ready', 'failed']).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export type ListGraphicsInput = z.infer<typeof listGraphicsSchema>;
