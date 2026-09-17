import { z } from 'zod';

export const listContentBatchesSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .enum([
      'planning',
      'generating',
      'review',
      'scheduling',
      'completed',
      'failed',
    ])
    .optional(),
});

export type ListContentBatchesInput = z.infer<typeof listContentBatchesSchema>;
