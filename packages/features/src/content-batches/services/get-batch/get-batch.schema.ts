import { z } from 'zod';

export const getBatchSchema = z.object({
  id: z.string().min(1, 'Batch ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetBatchInput = z.infer<typeof getBatchSchema>;
